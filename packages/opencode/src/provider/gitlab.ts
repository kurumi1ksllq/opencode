import os from "os"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { iife } from "@/util/iife"
import { InstanceState } from "@/effect/instance-state"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ModelID, ProviderID } from "./schema"
import type { Model, Info } from "./schema"
import type { CustomDep, CustomLoader } from "./bundled-providers"

const log = Log.create({ service: "gitlab-provider" })

export function gitlabLoader(dep: CustomDep): CustomLoader {
  return Effect.fnUntraced(function* (input: Info) {
    const {
      VERSION: GITLAB_PROVIDER_VERSION,
      isWorkflowModel,
      discoverWorkflowModels,
    } = yield* Effect.promise(() => import("gitlab-ai-provider"))

    const instanceUrl = (yield* dep.get("GITLAB_INSTANCE_URL")) || "https://gitlab.com"

    const auth = yield* dep.auth(input.id)
    const apiKey = yield* Effect.sync(() => {
      if (auth?.type === "oauth") return auth.access
      if (auth?.type === "api") return auth.key
      return undefined
    })
    const token = apiKey ?? (yield* dep.get("GITLAB_TOKEN"))

    const providerConfig = (yield* dep.config()).provider?.["gitlab"]
    const directory = yield* InstanceState.directory

    const aiGatewayHeaders = {
      "User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
      "anthropic-beta": "context-1m-2025-08-07",
      ...providerConfig?.options?.aiGatewayHeaders,
    }

    const featureFlags = {
      duo_agent_platform_agentic_chat: true,
      duo_agent_platform: true,
      ...providerConfig?.options?.featureFlags,
    }

    return {
      autoload: !!token,
      options: {
        instanceUrl,
        apiKey: token,
        aiGatewayHeaders,
        featureFlags,
      },
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (modelID.startsWith("duo-workflow-")) {
          const workflowRef = typeof options?.workflowRef === "string" ? options.workflowRef : undefined
          // Use the static mapping if it exists, otherwise use duo-workflow with selectedModelRef
          const sdkModelID = isWorkflowModel(modelID) ? modelID : "duo-workflow"
          const workflowDefinition =
            typeof options?.workflowDefinition === "string" ? options.workflowDefinition : undefined
          const model = sdk.workflowChat(sdkModelID, {
            featureFlags,
            workflowDefinition,
          })
          if (workflowRef) {
            model.selectedModelRef = workflowRef
          }
          return model
        }
        return sdk.agenticChat(modelID, {
          aiGatewayHeaders,
          featureFlags,
        })
      },
      async discoverModels(): Promise<Record<string, Model>> {
        if (!apiKey) {
          log.info("gitlab model discovery skipped: no apiKey")
          return {}
        }

        try {
          const token = apiKey
          const getHeaders = (): Record<string, string> =>
            auth?.type === "api" ? { "PRIVATE-TOKEN": token } : { Authorization: `Bearer ${token}` }

          log.info("gitlab model discovery starting", { instanceUrl })
          const result = await discoverWorkflowModels({ instanceUrl, getHeaders }, { workingDirectory: directory })

          if (!result.models.length) {
            log.info("gitlab model discovery skipped: no models found", {
              project: result.project
                ? {
                    id: result.project.id,
                    path: result.project.pathWithNamespace,
                  }
                : null,
            })
            return {}
          }

          const models: Record<string, Model> = {}
          for (const m of result.models) {
            if (!input.models[m.id]) {
              models[m.id] = {
                id: ModelID.make(m.id),
                providerID: ProviderID.make("gitlab"),
                name: `Agent Platform (${m.name})`,
                family: "",
                api: {
                  id: m.id,
                  url: instanceUrl,
                  npm: "gitlab-ai-provider",
                },
                status: "active",
                headers: {},
                options: { workflowRef: m.ref },
                cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
                limit: { context: m.context, output: m.output },
                capabilities: {
                  temperature: false,
                  reasoning: true,
                  attachment: true,
                  toolcall: true,
                  input: {
                    text: true,
                    audio: false,
                    image: true,
                    video: false,
                    pdf: true,
                  },
                  output: {
                    text: true,
                    audio: false,
                    image: false,
                    video: false,
                    pdf: false,
                  },
                  interleaved: false,
                },
                release_date: "",
                variants: {},
              }
            }
          }

          log.info("gitlab model discovery complete", {
            count: Object.keys(models).length,
            models: Object.keys(models),
          })
          return models
        } catch (e) {
          log.warn("gitlab model discovery failed", { error: e })
          return {}
        }
      },
    }
  })
}
