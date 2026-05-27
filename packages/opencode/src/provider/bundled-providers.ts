import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { Auth } from "../auth"
import type { Config } from "@/config/config"
import { Effect } from "effect"
import type { Model, Info } from "./schema"

export type BundledSDK = {
  languageModel(modelId: string): LanguageModelV3
}

export const BUNDLED_PROVIDERS: Record<string, () => Promise<(opts: any) => BundledSDK>> = {
  "@ai-sdk/amazon-bedrock": () => import("@ai-sdk/amazon-bedrock").then((m) => m.createAmazonBedrock),
  "@ai-sdk/anthropic": () => import("@ai-sdk/anthropic").then((m) => m.createAnthropic),
  "@ai-sdk/azure": () => import("@ai-sdk/azure").then((m) => m.createAzure),
  "@ai-sdk/google": () => import("@ai-sdk/google").then((m) => m.createGoogleGenerativeAI),
  "@ai-sdk/google-vertex": () => import("@ai-sdk/google-vertex").then((m) => m.createVertex),
  "@ai-sdk/google-vertex/anthropic": () =>
    import("@ai-sdk/google-vertex/anthropic").then((m) => m.createVertexAnthropic),
  "@ai-sdk/openai": () => import("@ai-sdk/openai").then((m) => m.createOpenAI),
  "@ai-sdk/openai-compatible": () => import("@ai-sdk/openai-compatible").then((m) => m.createOpenAICompatible),
  "@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider").then((m) => m.createOpenRouter),
  "@ai-sdk/xai": () => import("@ai-sdk/xai").then((m) => m.createXai),
  "@ai-sdk/mistral": () => import("@ai-sdk/mistral").then((m) => m.createMistral),
  "@ai-sdk/groq": () => import("@ai-sdk/groq").then((m) => m.createGroq),
  "@ai-sdk/deepinfra": () => import("@ai-sdk/deepinfra").then((m) => m.createDeepInfra),
  "@ai-sdk/cerebras": () => import("@ai-sdk/cerebras").then((m) => m.createCerebras),
  "@ai-sdk/cohere": () => import("@ai-sdk/cohere").then((m) => m.createCohere),
  "@ai-sdk/gateway": () => import("@ai-sdk/gateway").then((m) => m.createGateway),
  "@ai-sdk/togetherai": () => import("@ai-sdk/togetherai").then((m) => m.createTogetherAI),
  "@ai-sdk/perplexity": () => import("@ai-sdk/perplexity").then((m) => m.createPerplexity),
  "@ai-sdk/vercel": () => import("@ai-sdk/vercel").then((m) => m.createVercel),
  "@ai-sdk/alibaba": () => import("@ai-sdk/alibaba").then((m) => m.createAlibaba),
  "gitlab-ai-provider": () => import("gitlab-ai-provider").then((m) => m.createGitLab),
  "@ai-sdk/github-copilot": () =>
    import("@opencode-ai/core/github-copilot/copilot-provider").then((m) => m.createOpenaiCompatible),
  "venice-ai-sdk-provider": () => import("venice-ai-sdk-provider").then((m) => m.createVenice),
}

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
export type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
export type CustomDiscoverModels = () => Promise<Record<string, Model>>
export type CustomLoader = (provider: Info) => Effect.Effect<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
  discoverModels?: CustomDiscoverModels
}>

export type CustomDep = {
  auth: (id: string) => Effect.Effect<Auth.Info | undefined>
  config: () => Effect.Effect<Config.Info>
  env: () => Effect.Effect<Record<string, string | undefined>>
  get: (key: string) => Effect.Effect<string | undefined>
}
