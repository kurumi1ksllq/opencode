import { type CancelNotification, type PromptRequest, type Usage } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { ACPRuntime } from "./runtime"
import type { Agent } from "./agent"
import { defaultModel, sendUsageUpdate, parseUri } from "./agent-helpers"

const log = Log.create({ service: "acp-agent" })

export async function prompt(agent: Agent, params: PromptRequest) {
  const sessionID = params.sessionId
  const session = agent.sessionManager.get(sessionID)
  const directory = session.cwd

  const current = session.model
  const model = current ?? (await defaultModel(agent.config, directory))
  if (!current) {
    agent.sessionManager.setModel(session.id, model)
  }
  const currentAgent = session.modeId ?? (await ACPRuntime.defaultAgentInfo(directory)).name

  const parts: Array<
    | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
    | { type: "file"; url: string; filename: string; mime: string }
  > = []
  for (const part of params.prompt) {
    switch (part.type) {
      case "text":
        const audience = part.annotations?.audience
        const forAssistant = audience?.length === 1 && audience[0] === "assistant"
        const forUser = audience?.length === 1 && audience[0] === "user"
        parts.push({
          type: "text" as const,
          text: part.text,
          ...(forAssistant && { synthetic: true }),
          ...(forUser && { ignored: true }),
        })
        break
      case "image": {
        const parsed = parseUri(part.uri ?? "")
        const filename = parsed.type === "file" ? parsed.filename : "image"
        if (part.data) {
          parts.push({
            type: "file",
            url: `data:${part.mimeType};base64,${part.data}`,
            filename,
            mime: part.mimeType,
          })
        } else if (part.uri && part.uri.startsWith("http:")) {
          parts.push({
            type: "file",
            url: part.uri,
            filename,
            mime: part.mimeType,
          })
        }
        break
      }

      case "resource_link":
        const parsed = parseUri(part.uri)
        // Use the name from resource_link if available
        if (part.name && parsed.type === "file") {
          parsed.filename = part.name
        }
        parts.push(parsed)

        break

      case "resource": {
        const resource = part.resource
        if ("text" in resource && resource.text) {
          parts.push({
            type: "text",
            text: resource.text,
          })
        } else if ("blob" in resource && resource.blob && resource.mimeType) {
          // Binary resource (PDFs, etc.): store as file part with data URL
          const parsed = parseUri(resource.uri ?? "")
          const filename = parsed.type === "file" ? parsed.filename : "file"
          parts.push({
            type: "file",
            url: `data:${resource.mimeType};base64,${resource.blob}`,
            filename,
            mime: resource.mimeType,
          })
        }
        break
      }

      default:
        break
    }
  }

  log.info("parts", { parts })

  const cmd = (() => {
    const text = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("")
      .trim()

    if (!text.startsWith("/")) return

    const [name, ...rest] = text.slice(1).split(/\s+/)
    return { name, args: rest.join(" ").trim() }
  })()

  const buildUsage = (msg: AssistantMessage): Usage => ({
    totalTokens:
      msg.tokens.input +
      msg.tokens.output +
      msg.tokens.reasoning +
      (msg.tokens.cache?.read ?? 0) +
      (msg.tokens.cache?.write ?? 0),
    inputTokens: msg.tokens.input,
    outputTokens: msg.tokens.output,
    thoughtTokens: msg.tokens.reasoning || undefined,
    cachedReadTokens: msg.tokens.cache?.read || undefined,
    cachedWriteTokens: msg.tokens.cache?.write || undefined,
  })

  if (!cmd) {
    const response = await agent.sdk.session.prompt({
      sessionID,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      variant: agent.sessionManager.getVariant(sessionID),
      parts,
      agent: currentAgent,
      directory,
    })
    const msg = response.data?.info

    await sendUsageUpdate(agent.connection, agent.sdk, sessionID, directory)

    return {
      stopReason: "end_turn" as const,
      usage: msg ? buildUsage(msg) : undefined,
      _meta: {},
    }
  }

  const command = await agent.config.sdk.command
    .list({ directory }, { throwOnError: true })
    .then((x) => x.data!.find((c) => c.name === cmd.name))
  if (command) {
    const response = await agent.sdk.session.command({
      sessionID,
      command: command.name,
      arguments: cmd.args,
      model: model.providerID + "/" + model.modelID,
      agent: currentAgent,
      directory,
    })
    const msg = response.data?.info

    await sendUsageUpdate(agent.connection, agent.sdk, sessionID, directory)

    return {
      stopReason: "end_turn" as const,
      usage: msg ? buildUsage(msg) : undefined,
      _meta: {},
    }
  }

  switch (cmd.name) {
    case "compact":
      await agent.config.sdk.session.summarize(
        {
          sessionID,
          directory,
          providerID: model.providerID,
          modelID: model.modelID,
        },
        { throwOnError: true },
      )
      break
  }

  await sendUsageUpdate(agent.connection, agent.sdk, sessionID, directory)

  return {
    stopReason: "end_turn" as const,
    _meta: {},
  }
}

export async function cancel(agent: Agent, params: CancelNotification) {
  const session = agent.sessionManager.get(params.sessionId)
  await agent.config.sdk.session.abort(
    {
      sessionID: params.sessionId,
      directory: session.cwd,
    },
    { throwOnError: true },
  )
}
