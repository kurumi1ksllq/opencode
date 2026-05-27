import fuzzysort from "fuzzysort"
import { mapValues, mergeDeep, pickBy, sortBy, omit } from "remeda"
import { type Provider as SDK } from "ai"
import * as Log from "@opencode-ai/core/util/log"
import { Npm } from "@opencode-ai/core/npm"
import { Hash } from "@opencode-ai/core/util/hash"
import { type LanguageModelV3 } from "@ai-sdk/provider"
import * as ModelsDev from "@opencode-ai/core/models-dev"
import { iife } from "@/util/iife"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Types } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { ModelID, ProviderID, Model, Info } from "./schema"
import { ModelStatus } from "./model-status"
import * as ProviderVariants from "./model-variants"
import type { BundledSDK, CustomModelLoader, CustomVarsLoader } from "./bundled-providers"
import { BUNDLED_PROVIDERS } from "./bundled-providers"
import { wrapSSE, googleVertexAnthropicBaseURL } from "./util"
import { InitError } from "./error"

const log = Log.create({ service: "model-transform" })

// --- Schema schemas (re-exported from schema.ts for convenience) ---
export { Model, Info } from "./schema"
export type { ModelID, ProviderID } from "./schema"

// --- State type ---
export interface State {
  models: Map<string, LanguageModelV3>
  providers: Record<string, Info>
  catalog: Record<string, Info>
  sdk: Map<string, BundledSDK>
  modelLoaders: Record<string, CustomModelLoader>
  varsLoaders: Record<string, CustomVarsLoader>
}

// --- Utility functions ---

export function toPublicInfo(provider: Info): Info {
  return JSON.parse(
    JSON.stringify(provider, (_, value) => {
      if (typeof value === "function" || typeof value === "symbol" || value === undefined) return undefined
      if (typeof value === "bigint") return value.toString()
      return value
    }),
  )
}

export function defaultModelIDs<T extends { models: Record<string, { id: string }> }>(providers: Record<string, T>) {
  return mapValues(providers, (item) => sort(Object.values(item.models))[0].id)
}

function cost(c: ModelsDev.Model["cost"]): Model["cost"] {
  const result: Model["cost"] = {
    input: c?.input ?? 0,
    output: c?.output ?? 0,
    cache: {
      read: c?.cache_read ?? 0,
      write: c?.cache_write ?? 0,
    },
  }
  if (c?.tiers) {
    result.tiers = c.tiers.map((item) => ({
      input: item.input,
      output: item.output,
      cache: {
        read: item.cache_read ?? 0,
        write: item.cache_write ?? 0,
      },
      tier: item.tier,
    }))
  }
  if (c?.context_over_200k) {
    result.experimentalOver200K = {
      cache: {
        read: c.context_over_200k.cache_read ?? 0,
        write: c.context_over_200k.cache_write ?? 0,
      },
      input: c.context_over_200k.input,
      output: c.context_over_200k.output,
    }
  }
  return result
}

function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
  const base: Model = {
    id: ModelID.make(model.id),
    providerID: ProviderID.make(provider.id),
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: model.provider?.api ?? provider.api ?? "",
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: {},
    options: {},
    cost: cost(model.cost),
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature ?? false,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      toolcall: model.tool_call ?? true,
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? false,
        audio: model.modalities?.output?.includes("audio") ?? false,
        image: model.modalities?.output?.includes("image") ?? false,
        video: model.modalities?.output?.includes("video") ?? false,
        pdf: model.modalities?.output?.includes("pdf") ?? false,
      },
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date ?? "",
    variants: {},
  }

  return {
    ...base,
    variants: mapValues(ProviderVariants.variants(base), (v) => v),
  }
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
  const models: Record<string, Model> = {}
  for (const [key, model] of Object.entries(provider.models)) {
    models[key] = fromModelsDevModel(provider, model)
    for (const [mode, opts] of Object.entries(model.experimental?.modes ?? {})) {
      const id = `${model.id}-${mode}`
      const base = fromModelsDevModel(provider, model)
      models[id] = {
        ...base,
        id: ModelID.make(id),
        name: `${model.name} ${mode[0].toUpperCase()}${mode.slice(1)}`,
        cost: opts.cost ? mergeDeep(base.cost, cost(opts.cost)) : base.cost,
        options: opts.provider?.body
          ? Object.fromEntries(
              Object.entries(opts.provider.body).map(([k, v]) => [
                k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
                v,
              ]),
            )
          : base.options,
        headers: opts.provider?.headers ?? base.headers,
      }
    }
  }
  return {
    id: ProviderID.make(provider.id),
    source: "custom",
    name: provider.name,
    env: [...(provider.env ?? [])],
    options: {},
    models,
  }
}

function suggestionModelIDs(provider: Info | undefined, enableExperimentalModels: boolean) {
  if (!provider) return []
  return Object.keys(provider.models).filter((id) => {
    const model = provider.models[id]
    if (model.status === "deprecated") return false
    if (model.status === "alpha" && !enableExperimentalModels) return false
    return true
  })
}

export function modelSuggestions(provider: Info | undefined, modelID: string, enableExperimentalModels: boolean) {
  const available = suggestionModelIDs(provider, enableExperimentalModels)
  const fuzzy = fuzzysort.go(modelID, available, { limit: 3, threshold: -10000 }).map((m) => m.target)
  if (fuzzy.length) return fuzzy
  const query = modelID
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length > 1)
  return sortBy(
    available
      .map((id) => ({
        id,
        score: query.filter((part) => id.toLowerCase().includes(part)).length,
      }))
      .filter((item) => item.score > 0),
    [(item) => item.score, "desc"],
    [(item) => item.id, "asc"],
  )
    .slice(0, 3)
    .map((item) => item.id)
}

// --- SDK resolution ---

export async function resolveSDK(model: Model, s: State, envs: Record<string, string | undefined>) {
  try {
    using _ = log.time("getSDK", {
      providerID: model.providerID,
    })
    const provider = s.providers[model.providerID]
    const options = { ...provider.options }

    if (
      model.providerID === "google-vertex" &&
      model.api.npm === "@ai-sdk/google-vertex/anthropic" &&
      !options.baseURL
    ) {
      const baseURL = googleVertexAnthropicBaseURL(
        typeof options.project === "string" ? options.project : undefined,
        typeof options.location === "string" ? options.location : undefined,
      )
      if (baseURL) options.baseURL = baseURL
    }

    if (model.providerID === "google-vertex" && !model.api.npm.includes("@ai-sdk/openai-compatible")) {
      delete options.fetch
    }

    if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
      options["includeUsage"] = true
    }

    const baseURL = iife(() => {
      let url =
        typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
      if (!url) return

      const loader = s.varsLoaders[model.providerID]
      if (loader) {
        const vars = loader(options)
        for (const [key, value] of Object.entries(vars)) {
          const field = "${" + key + "}"
          url = url.replaceAll(field, value)
        }
      }

      url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
        const val = envs[String(key)]
        return val ?? item
      })
      return url
    })

    if (baseURL !== undefined) options["baseURL"] = baseURL
    if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
    if (model.headers)
      options["headers"] = {
        ...options["headers"],
        ...model.headers,
      }

    const key = Hash.fast(
      JSON.stringify({
        providerID: model.providerID,
        npm: model.api.npm,
        options,
      }),
    )
    const existing = s.sdk.get(key)
    if (existing) return existing

    const customFetch = options["fetch"]
    const chunkTimeout = options["chunkTimeout"]
    delete options["chunkTimeout"]

    options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}
      const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
      const signals: AbortSignal[] = []

      if (opts.signal) signals.push(opts.signal)
      if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
      if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
        signals.push(AbortSignal.timeout(options["timeout"]))

      const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
      if (combined) opts.signal = combined

      // Strip openai itemId metadata following what codex does
      if (
        (model.api.npm === "@ai-sdk/openai" || model.api.npm === "@ai-sdk/azure") &&
        opts.body &&
        opts.method === "POST"
      ) {
        const body = JSON.parse(opts.body as string)
        const keepIds = body.store === true
        if (!keepIds && Array.isArray(body.input)) {
          for (const item of body.input) {
            if ("id" in item) {
              delete item.id
            }
          }
          opts.body = JSON.stringify(body)
        }
      }

      const res = await fetchFn(input, {
        ...opts,
        // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
        timeout: false,
      })

      if (!chunkAbortCtl) return res
      return wrapSSE(res, chunkTimeout, chunkAbortCtl)
    }

    const bundledLoader = BUNDLED_PROVIDERS[model.api.npm]
    if (bundledLoader) {
      log.info("using bundled provider", {
        providerID: model.providerID,
        pkg: model.api.npm,
      })
      const factory = await bundledLoader()
      const loaded = factory({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    }

    let installedPath: string
    if (!model.api.npm.startsWith("file://")) {
      const item = await Npm.add(model.api.npm)
      if (!item.entrypoint) throw new Error(`Package ${model.api.npm} has no import entrypoint`)
      installedPath = item.entrypoint
    } else {
      log.info("loading local provider", { pkg: model.api.npm })
      installedPath = model.api.npm
    }

    // `installedPath` is a local entry path or an existing `file://` URL. Normalize
    // only path inputs so Node on Windows accepts the dynamic import.
    const importSpec = installedPath.startsWith("file://") ? installedPath : pathToFileURL(installedPath).href
    const mod = await import(importSpec)

    const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
    const loaded = fn({
      name: model.providerID,
      ...options,
    })
    s.sdk.set(key, loaded)
    return loaded as SDK
  } catch (e) {
    throw new InitError({ providerID: model.providerID, cause: e })
  }
}

// --- Sorting / model helpers ---

const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
export function sort<T extends { id: string }>(models: T[]) {
  return sortBy(
    models,
    [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
    [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
    [(model) => model.id, "desc"],
  )
}

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}
