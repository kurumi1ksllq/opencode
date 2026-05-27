import {
  type AgentSideConnection,
  type SessionConfigOption,
  type ToolCallContent,
  type ToolKind,
} from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { pathToFileURL } from "url"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import type { OpencodeClient, ToolPart } from "@opencode-ai/sdk/v2"
import { applyPatch } from "diff"
import { ShellID } from "@/tool/shell/id"
import type { ACPConfig } from "./types"

const log = Log.create({ service: "acp-agent" })

export type ModeOption = { id: string; name: string; description?: string }
export type ModelOption = { modelId: string; name: string }

export const DEFAULT_VARIANT_VALUE = "default"

export async function getContextLimit(
  sdk: OpencodeClient,
  providerID: ProviderID,
  modelID: ModelID,
  directory: string,
): Promise<number | null> {
  const providers = await sdk.config
    .providers({ directory })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to get providers for context limit", { error })
      return []
    })

  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  return model?.limit.context ?? null
}

export async function sendUsageUpdate(
  connection: AgentSideConnection,
  sdk: OpencodeClient,
  sessionID: string,
  directory: string,
): Promise<void> {
  const messages = await sdk.session
    .messages({ sessionID, directory }, { throwOnError: true })
    .then((x) => x.data)
    .catch((error) => {
      log.error("failed to fetch messages for usage update", { error })
      return undefined
    })

  if (!messages) return

  const assistantMessages = messages.filter(
    (m): m is { info: import("@opencode-ai/sdk/v2").AssistantMessage; parts: import("@opencode-ai/sdk/v2").SessionMessageResponse["parts"] } =>
      m.info.role === "assistant",
  )

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  if (!lastAssistant) return

  const msg = lastAssistant.info
  if (!msg.providerID || !msg.modelID) return
  const size = await getContextLimit(sdk, ProviderID.make(msg.providerID), ModelID.make(msg.modelID), directory)

  if (!size) {
    // Cannot calculate usage without known context size
    return
  }

  const used = msg.tokens.input + (msg.tokens.cache?.read ?? 0)
  const totalCost = assistantMessages.reduce((sum, m) => sum + m.info.cost, 0)

  await connection
    .sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
        cost: { amount: totalCost, currency: "USD" },
      },
    })
    .catch((error) => {
      log.error("failed to send usage update", { error })
    })
}

export function toToolKind(toolName: string): ToolKind {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case ShellID.ToolID:
      return "execute"

    case "webfetch":
      return "fetch"

    case "edit":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "repo_clone":
    case "repo_overview":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "read":
      return "read"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
  const tool = toolName.toLocaleLowerCase()

  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return input["filePath"] ? [{ path: input["filePath"] }] : []
    case "glob":
    case "grep":
      return input["path"] ? [{ path: input["path"] }] : []
    case "repo_clone":
      return input["path"] ? [{ path: input["path"] }] : []
    case "repo_overview":
      return input["path"] ? [{ path: input["path"] }] : []
    case ShellID.ToolID:
      return []
    default:
      return []
  }
}

export function completedToolContent(part: ToolPart, kind: ToolKind): ToolCallContent[] {
  if (part.state.status !== "completed") return []

  const content: ToolCallContent[] = [
    {
      type: "content",
      content: {
        type: "text",
        text: part.state.output,
      },
    },
  ]

  if (kind === "edit") {
    const input = part.state.input
    const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
    const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
    const newText =
      typeof input["newString"] === "string"
        ? input["newString"]
        : typeof input["content"] === "string"
          ? input["content"]
          : ""
    content.push({
      type: "diff",
      path: filePath,
      oldText,
      newText,
    })
  }

  content.push(...imageContents(part.state.attachments ?? []))
  return content
}

export function completedToolRawOutput(part: ToolPart) {
  if (part.state.status !== "completed") return {}
  return {
    output: part.state.output,
    metadata: part.state.metadata,
    ...(part.state.attachments?.length ? { attachments: part.state.attachments } : {}),
  }
}

export function imageContents(attachments: Array<{ mime: string; url: string }>): ToolCallContent[] {
  return attachments.flatMap((attachment): ToolCallContent[] => {
    const match = attachment.url.match(/^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/)
    const mime = match?.[1] ?? attachment.mime
    if (!mime.startsWith("image/")) return []
    const data = match?.[2]
    if (data === undefined) return []
    return [
      {
        type: "content" as const,
        content: {
          type: "image" as const,
          mimeType: mime,
          data,
        },
      },
    ]
  })
}

export async function defaultModel(config: ACPConfig, cwd?: string): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  const sdk = config.sdk
  const configured = config.defaultModel
  if (configured) return configured

  const directory = cwd ?? process.cwd()

  const specified = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((resp) => {
      const cfg = resp.data
      if (!cfg || !cfg.model) return undefined
      return Provider.parseModel(cfg.model)
    })
    .catch((error) => {
      log.error("failed to load user config for default model", { error })
      return undefined
    })

  const providers = await sdk.config
    .providers({ directory }, { throwOnError: true })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to list providers for default model", { error })
      return []
    })

  if (specified && providers.length) {
    const provider = providers.find((p) => p.id === specified.providerID)
    if (provider && provider.models[specified.modelID]) return specified
  }

  if (specified && !providers.length) return specified

  const lastUsed = await lastUsedModel(sdk, directory, providers)
  if (lastUsed) return lastUsed

  const opencodeProvider = providers.find((p) => p.id === "opencode")
  if (opencodeProvider) {
    const [best] = Provider.sort(Object.values(opencodeProvider.models))
    if (best) {
      return {
        providerID: ProviderID.make(best.providerID),
        modelID: ModelID.make(best.id),
      }
    }
  }

  const models = providers.flatMap((p) => Object.values(p.models))
  const [best] = Provider.sort(models)
  if (best) {
    return {
      providerID: ProviderID.make(best.providerID),
      modelID: ModelID.make(best.id),
    }
  }

  if (specified) return specified
  throw new Error("No models available")
}

export async function lastUsedModel(
  sdk: OpencodeClient,
  directory: string,
  providers: Array<{ id: string; models: Record<string, unknown> }>,
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const session = await sdk.session
    .list({ directory, roots: true, limit: 1 }, { throwOnError: true })
    .then((x) => x.data?.[0])
    .catch((error) => {
      log.error("failed to list sessions for default model", { error })
      return undefined
    })
  if (!session) return

  const lastUser = await sdk.session
    .messages({ sessionID: session.id, directory, limit: 20 }, { throwOnError: true })
    .then((x) => x.data?.findLast((message) => message.info.role === "user")?.info)
    .catch((error) => {
      log.error("failed to load session messages for default model", { error, sessionID: session.id })
      return undefined
    })
  if (lastUser?.role !== "user") return

  const provider = providers.find((entry) => entry.id === lastUser.model.providerID)
  if (!provider?.models[lastUser.model.modelID]) return
  return {
    providerID: ProviderID.make(lastUser.model.providerID),
    modelID: ModelID.make(lastUser.model.modelID),
  }
}

export function parseUri(
  uri: string,
): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7)
      const name = path.split("/").pop() || path
      return {
        type: "file",
        url: uri,
        filename: name,
        mime: "text/plain",
      }
    }
    if (uri.startsWith("zed://")) {
      const url = new URL(uri)
      const path = url.searchParams.get("path")
      if (path) {
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: pathToFileURL(path).href,
          filename: name,
          mime: "text/plain",
        }
      }
    }
    return {
      type: "text",
      text: uri,
    }
  } catch {
    return {
      type: "text",
      text: uri,
    }
  }
}

export function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
  const result = applyPatch(fileOriginal, unifiedDiff)
  if (result === false) {
    log.error("Failed to apply unified diff (context mismatch)")
    return undefined
  }
  return result
}

export function sortProvidersByName<T extends { name: string }>(providers: T[]): T[] {
  return [...providers].sort((a, b) => {
    const nameA = a.name.toLowerCase()
    const nameB = b.name.toLowerCase()
    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })
}

export function modelVariantsFromProviders(
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
  model: { providerID: ProviderID; modelID: ModelID },
): string[] {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) return []
  const modelInfo = provider.models[model.modelID]
  if (!modelInfo?.variants) return []
  return Object.keys(modelInfo.variants)
}

export function buildAvailableModels(
  providers: Array<{ id: string; name: string; models: Record<string, any> }>,
  options: { includeVariants?: boolean } = {},
): ModelOption[] {
  const includeVariants = options.includeVariants ?? false
  return providers.flatMap((provider) => {
    const unsorted: Array<{ id: string; name: string; variants?: Record<string, any> }> = Object.values(provider.models)
    const models = Provider.sort(unsorted)
    return models.flatMap((model) => {
      const base: ModelOption = {
        modelId: `${provider.id}/${model.id}`,
        name: `${provider.name}/${model.name}`,
      }
      if (!includeVariants || !model.variants) return [base]
      const variants = Object.keys(model.variants).filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
      const variantOptions = variants.map((variant) => ({
        modelId: `${provider.id}/${model.id}/${variant}`,
        name: `${provider.name}/${model.name} (${variant})`,
      }))
      return [base, ...variantOptions]
    })
  })
}

export function formatModelIdWithVariant(
  model: { providerID: ProviderID; modelID: ModelID },
  variant: string | undefined,
  availableVariants: string[],
  includeVariant: boolean,
) {
  const base = `${model.providerID}/${model.modelID}`
  if (!includeVariant || availableVariants.length === 0) return base
  const selectedVariant =
    variant && availableVariants.includes(variant)
      ? variant
      : availableVariants.includes(DEFAULT_VARIANT_VALUE)
        ? DEFAULT_VARIANT_VALUE
        : availableVariants[0]
  return `${base}/${selectedVariant}`
}

export function buildVariantMeta(input: {
  model: { providerID: ProviderID; modelID: ModelID }
  variant?: string
  availableVariants: string[]
}) {
  return {
    opencode: {
      modelId: `${input.model.providerID}/${input.model.modelID}`,
      variant: input.variant ?? null,
      availableVariants: input.availableVariants,
    },
  }
}

export function parseModelSelection(
  modelId: string,
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
): { model: { providerID: ProviderID; modelID: ModelID }; variant?: string } {
  const parsed = Provider.parseModel(modelId)
  const provider = providers.find((p) => p.id === parsed.providerID)
  if (!provider) {
    return { model: parsed, variant: undefined }
  }

  // Check if modelID exists directly
  if (provider.models[parsed.modelID]) {
    return { model: parsed, variant: undefined }
  }

  // Try to extract variant from end of modelID (e.g., "claude-sonnet-4/high" -> model: "claude-sonnet-4", variant: "high")
  const segments = parsed.modelID.split("/")
  if (segments.length > 1) {
    const candidateVariant = segments[segments.length - 1]
    const baseModelId = segments.slice(0, -1).join("/")
    const baseModelInfo = provider.models[baseModelId]
    if (baseModelInfo?.variants && candidateVariant in baseModelInfo.variants) {
      return {
        model: { providerID: parsed.providerID, modelID: ModelID.make(baseModelId) },
        variant: candidateVariant,
      }
    }
  }

  return { model: parsed, variant: undefined }
}

export function buildConfigOptions(input: {
  currentModelId: string
  availableModels: ModelOption[]
  currentVariant?: string
  availableVariants?: string[]
  modes?: { availableModes: ModeOption[]; currentModeId: string } | undefined
}): SessionConfigOption[] {
  const options: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: input.currentModelId,
      options: input.availableModels.map((m) => ({ value: m.modelId, name: m.name })),
    },
  ]
  if (input.availableVariants?.length) {
    options.push({
      id: "effort",
      name: "Effort",
      description: "Available effort levels for this model",
      category: "thought_level",
      type: "select",
      currentValue:
        input.currentVariant && input.availableVariants.includes(input.currentVariant)
          ? input.currentVariant
          : input.availableVariants.includes(DEFAULT_VARIANT_VALUE)
            ? DEFAULT_VARIANT_VALUE
            : input.availableVariants[0],
      options: input.availableVariants.map((variant) => ({ value: variant, name: formatVariantName(variant) })),
    })
  }
  if (input.modes) {
    options.push({
      id: "mode",
      name: "Session Mode",
      category: "mode",
      type: "select",
      currentValue: input.modes.currentModeId,
      options: input.modes.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        ...(m.description ? { description: m.description } : {}),
      })),
    })
  }
  return options
}

export function formatVariantName(variant: string) {
  return variant
    .split(/[_-]/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ")
}


