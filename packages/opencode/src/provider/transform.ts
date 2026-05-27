import { mergeDeep } from "remeda"
import type { ModelMessage } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type * as Provider from "./provider"
import { iife } from "@/util/iife"

import { OUTPUT_TOKEN_MAX, sdkKey } from "./model-messages"
export { message, sanitizeSurrogates, OUTPUT_TOKEN_MAX } from "./model-messages"
export { variants } from "./model-variants"

export function temperature(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("qwen")) return 0.55
  if (id.includes("claude")) return undefined
  if (id.includes("gemini")) return 1.0
  if (id.includes("glm-4.6")) return 1.0
  if (id.includes("glm-4.7")) return 1.0
  if (id.includes("minimax-m2")) return 1.0
  if (id.includes("kimi-k2")) {
    // kimi-k2-thinking & kimi-k2.5 && kimi-k2p5 && kimi-k2-5
    if (["thinking", "k2.", "k2p", "k2-5"].some((s) => id.includes(s))) {
      return 1.0
    }
    return 0.6
  }
  return undefined
}

export function topP(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("qwen")) return 1
  if (["minimax-m2", "gemini", "kimi-k2.5", "kimi-k2p5", "kimi-k2-5"].some((s) => id.includes(s))) {
    return 0.95
  }
  return undefined
}

export function topK(model: Provider.Model) {
  const id = model.id.toLowerCase()
  if (id.includes("minimax-m2")) {
    if (["m2.", "m25", "m21"].some((s) => id.includes(s))) return 40
    return 20
  }
  if (id.includes("gemini")) return 64
  return undefined
}

export function options(input: {
  model: Provider.Model
  sessionID: string
  providerOptions?: Record<string, any>
}): Record<string, any> {
  const result: Record<string, any> = {}

  if (
    input.model.api.npm === "@ai-sdk/google-vertex/anthropic" ||
    (!input.model.api.id.includes("claude") && input.model.api.npm === "@ai-sdk/anthropic")
  ) {
    result["toolStreaming"] = false
  }

  // openai and providers using openai package should set store to false by default.
  if (
    input.model.providerID === "openai" ||
    input.model.api.npm === "@ai-sdk/openai" ||
    input.model.api.npm === "@ai-sdk/github-copilot"
  ) {
    result["store"] = false
  }

  if (input.model.api.npm === "@ai-sdk/azure") {
    result["store"] = false
    result["promptCacheKey"] = input.sessionID
  }

  if (input.model.api.npm === "@openrouter/ai-sdk-provider" || input.model.api.npm === "@llmgateway/ai-sdk-provider") {
    result["usage"] = {
      include: true,
    }
    if (input.model.api.id.includes("gemini-3")) {
      result["reasoning"] = { effort: "high" }
    }
  }

  if (
    input.model.providerID === "baseten" ||
    (input.model.providerID === "opencode" && ["kimi-k2-thinking", "glm-4.6"].includes(input.model.api.id))
  ) {
    result["chat_template_args"] = { enable_thinking: true }
  }

  if (
    ["zai", "zhipuai"].some((id) => input.model.providerID.includes(id)) &&
    input.model.api.npm === "@ai-sdk/openai-compatible"
  ) {
    result["thinking"] = {
      type: "enabled",
      clear_thinking: false,
    }
  }

  if (input.model.providerID === "openai" || input.providerOptions?.setCacheKey) {
    result["promptCacheKey"] = input.sessionID
  }

  if (input.model.api.npm === "@ai-sdk/google" || input.model.api.npm === "@ai-sdk/google-vertex") {
    if (input.model.capabilities.reasoning) {
      result["thinkingConfig"] = {
        includeThoughts: true,
      }
      if (input.model.api.id.includes("gemini-3")) {
        result["thinkingConfig"]["thinkingLevel"] = "high"
      }
    }
  }

  // Enable thinking by default for kimi models using anthropic SDK
  const modelId = input.model.api.id.toLowerCase()
  if (
    (input.model.api.npm === "@ai-sdk/anthropic" || input.model.api.npm === "@ai-sdk/google-vertex/anthropic") &&
    (modelId.includes("k2p") || modelId.includes("kimi-k2.") || modelId.includes("kimi-k2p"))
  ) {
    result["thinking"] = {
      type: "enabled",
      budgetTokens: Math.min(16_000, Math.floor(input.model.limit.output / 2 - 1)),
    }
  }

  // Enable thinking for reasoning models on alibaba-cn (DashScope).
  // DashScope's OpenAI-compatible API requires `enable_thinking: true` in the request body
  // to return reasoning_content. Without it, models like kimi-k2.5, qwen-plus, qwen3, qwq,
  // deepseek-r1, etc. never output thinking/reasoning tokens.
  // Note: kimi-k2-thinking is excluded as it returns reasoning_content by default.
  if (
    input.model.providerID === "alibaba-cn" &&
    input.model.capabilities.reasoning &&
    input.model.api.npm === "@ai-sdk/openai-compatible" &&
    !modelId.includes("kimi-k2-thinking")
  ) {
    result["enable_thinking"] = true
  }

  if (input.model.api.npm === "@ai-sdk/azure" && input.model.api.id.includes("gpt-5.5")) {
    result["reasoningSummary"] = "auto"
    return result
  }

  if (input.model.api.id.includes("gpt-5") && !input.model.api.id.includes("gpt-5-chat")) {
    if (!input.model.api.id.includes("gpt-5-pro")) {
      result["reasoningEffort"] = "medium"
      result["reasoningSummary"] = "auto"
    }

    // Only set textVerbosity for non-chat gpt-5.x models
    // Chat models (e.g. gpt-5.2-chat-latest) only support "medium" verbosity
    if (
      input.model.api.id.includes("gpt-5.") &&
      !input.model.api.id.includes("codex") &&
      !input.model.api.id.includes("-chat") &&
      input.model.providerID !== "azure"
    ) {
      result["textVerbosity"] = "low"
    }

    if (input.model.providerID.startsWith("opencode")) {
      result["promptCacheKey"] = input.sessionID
      result["include"] = ["reasoning.encrypted_content"]
      result["reasoningSummary"] = "auto"
    }
  }

  if (input.model.providerID === "venice") {
    result["promptCacheKey"] = input.sessionID
  }

  if (input.model.providerID === "openrouter") {
    result["prompt_cache_key"] = input.sessionID
  }
  if (input.model.api.npm === "@ai-sdk/gateway") {
    result["gateway"] = {
      caching: "auto",
    }
  }

  return result
}

export function smallOptions(model: Provider.Model) {
  const small = Object.values(model.variants ?? {})[0] ?? {}
  if (
    model.providerID === "openai" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/github-copilot"
  ) {
    const base = { store: false }
    return mergeDeep(base, small)
  }
  if (model.providerID === "openrouter" || model.providerID === "llmgateway") {
    if (Object.keys(small).length === 0 && model.api.id.includes("google")) {
      return { reasoning: { enabled: false } }
    }
  }

  if (model.providerID === "venice") {
    if (Object.keys(small).length > 0) return small
    return { veniceParameters: { disableThinking: true } }
  }

  return small
}

// Maps model ID prefix to provider slug used in providerOptions.
// Example: "amazon/nova-2-lite" → "bedrock"
const SLUG_OVERRIDES: Record<string, string> = {
  amazon: "bedrock",
}

export function providerOptions(model: Provider.Model, options: { [x: string]: any }) {
  if (model.api.npm === "@ai-sdk/gateway") {
    // Gateway providerOptions are split across two namespaces:
    // - `gateway`: gateway-native routing/caching controls (order, only, byok, etc.)
    // - `<upstream slug>`: provider-specific model options (anthropic/openai/...)
    // We keep `gateway` as-is and route every other top-level option under the
    // model-derived upstream slug.
    const i = model.api.id.indexOf("/")
    const rawSlug = i > 0 ? model.api.id.slice(0, i) : undefined
    const slug = rawSlug ? (SLUG_OVERRIDES[rawSlug] ?? rawSlug) : undefined
    const gateway = options.gateway
    const rest = Object.fromEntries(Object.entries(options).filter(([k]) => k !== "gateway"))
    const has = Object.keys(rest).length > 0

    const result: Record<string, any> = {}
    if (gateway !== undefined) result.gateway = gateway

    if (has) {
      if (slug) {
        // Route model-specific options under the provider slug
        result[slug] = rest
      } else if (gateway && typeof gateway === "object" && !Array.isArray(gateway)) {
        result.gateway = { ...gateway, ...rest }
      } else {
        result.gateway = rest
      }
    }

    return result
  }

  // AI SDK packages that resolve providerOptionsName by splitting the
  // provider name on "." (e.g. "wafer.ai" -> "wafer") need the same
  // logic here so the key we write matches the key they read.
  // Other SDKs (xai, mistral, groq, cohere, etc.) use hardcoded keys
  // like "xai" or "cohere" - applying .split(".")[0] would break those.
  const usesDotSplitOptions =
    model.api.npm === "@ai-sdk/openai-compatible" ||
    model.api.npm === "@ai-sdk/openai" ||
    model.api.npm === "@ai-sdk/anthropic"
  const key = sdkKey(model.api.npm) ?? (usesDotSplitOptions ? model.providerID.split(".")[0] : model.providerID)
  // @ai-sdk/azure delegates to OpenAIChatLanguageModel which reads from
  // providerOptions["openai"], but OpenAIResponsesLanguageModel checks
  // "azure" first. Pass both so model options work on either code path.
  if (model.api.npm === "@ai-sdk/azure") {
    return { openai: options, azure: options }
  }
  return { [key]: options }
}

export function maxOutputTokens(model: Provider.Model, outputTokenMax = OUTPUT_TOKEN_MAX): number {
  return Math.min(model.limit.output, outputTokenMax) || outputTokenMax
}

export function schema(model: Provider.Model, schema: JSONSchema7): JSONSchema7 {
  /*
  if (["openai", "azure"].includes(providerID)) {
    if (schema.type === "object" && schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        if (schema.required?.includes(key)) continue
        schema.properties[key] = {
          anyOf: [
            value as JSONSchema.JSONSchema,
            {
              type: "null",
            },
          ],
        }
      }
    }
  }
  */

  if (model.providerID === "moonshotai" || model.api.id.toLowerCase().includes("kimi")) {
    const sanitizeMoonshot = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== "object") return obj
      if (Array.isArray(obj)) return obj.map(sanitizeMoonshot)
      // Moonshot expands $ref before validation and rejects sibling keywords like description on the same node.
      if ("$ref" in obj && typeof obj.$ref === "string") return { $ref: obj.$ref }
      const result = Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, sanitizeMoonshot(value)]))
      // MFJS does not support tuple-style `items` arrays; it requires one schema object for all array items.
      if (Array.isArray(result.items)) result.items = result.items[0] ?? {}
      return result
    }

    const sanitized = sanitizeMoonshot(schema)
    if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
      schema = sanitized
    }
  }

  // Convert integer enums to string enums for Google/Gemini
  if (model.providerID === "google" || model.api.id.includes("gemini")) {
    const isPlainObject = (node: unknown): node is Record<string, any> =>
      typeof node === "object" && node !== null && !Array.isArray(node)
    const hasCombiner = (node: unknown) =>
      isPlainObject(node) && (Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf))
    const hasSchemaIntent = (node: unknown) => {
      if (!isPlainObject(node)) return false
      if (hasCombiner(node)) return true
      return [
        "type",
        "properties",
        "items",
        "prefixItems",
        "enum",
        "const",
        "$ref",
        "additionalProperties",
        "patternProperties",
        "required",
        "not",
        "if",
        "then",
        "else",
      ].some((key) => key in node)
    }

    const sanitizeGemini = (obj: any): any => {
      if (obj === null || typeof obj !== "object") {
        return obj
      }

      if (Array.isArray(obj)) {
        return obj.map(sanitizeGemini)
      }

      const result: any = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === "enum" && Array.isArray(value)) {
          // Convert all enum values to strings
          result[key] = value.map((v) => String(v))
          // If we have integer type with enum, change type to string
          if (result.type === "integer" || result.type === "number") {
            result.type = "string"
          }
        } else if (typeof value === "object" && value !== null) {
          result[key] = sanitizeGemini(value)
        } else {
          result[key] = value
        }
      }

      // Filter required array to only include fields that exist in properties
      if (result.type === "object" && result.properties && Array.isArray(result.required)) {
        result.required = result.required.filter((field: any) => field in result.properties)
      }

      if (result.type === "array" && !hasCombiner(result)) {
        if (result.items == null) {
          result.items = {}
        }
        // Ensure items has a type only when it's still schema-empty.
        if (isPlainObject(result.items) && !hasSchemaIntent(result.items)) {
          result.items.type = "string"
        }
      }

      // Remove properties/required from non-object types (Gemini rejects these)
      if (result.type && result.type !== "object" && !hasCombiner(result)) {
        delete result.properties
        delete result.required
      }

      return result
    }

    schema = sanitizeGemini(schema)
  }

  return schema
}

export * as ProviderTransform from "./transform"
