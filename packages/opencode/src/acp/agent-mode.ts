import * as Log from "@opencode-ai/core/util/log"
import { ConfigMCP } from "@/config/mcp"
import type { LoadSessionRequest } from "@agentclientprotocol/sdk"
import type { Agent } from "./agent"
import { defaultModel, sortProvidersByName, modelVariantsFromProviders, buildAvailableModels, formatModelIdWithVariant, buildVariantMeta, buildConfigOptions } from "./agent-helpers"

const log = Log.create({ service: "acp-agent" })

export async function loadSessionMode(agent: Agent, params: LoadSessionRequest) {
  const directory = params.cwd
  const sessionId = params.sessionId
  const model = agent.sessionManager.get(sessionId).model ?? (await defaultModel(agent.config, directory))

  const providers = await agent.sdk.config.providers({ directory }).then((x) => x.data!.providers)
  const entries = sortProvidersByName(providers)
  const availableVariants = modelVariantsFromProviders(entries, model)
  const currentVariant = agent.sessionManager.getVariant(sessionId)
  if (currentVariant && !availableVariants.includes(currentVariant)) {
    agent.sessionManager.setVariant(sessionId, undefined)
  }
  const availableModels = buildAvailableModels(entries)
  const modeState = await agent.resolveModeState(directory, sessionId)
  const currentModeId = modeState.currentModeId
  const modes = currentModeId
    ? {
        availableModes: modeState.availableModes,
        currentModeId,
      }
    : undefined

  const commands = await agent.config.sdk.command
    .list(
      {
        directory,
      },
      { throwOnError: true },
    )
    .then((resp) => resp.data!)

  const availableCommands = commands.map((command) => ({
    name: command.name,
    description: command.description ?? "",
  }))
  const names = new Set(availableCommands.map((c) => c.name))
  if (!names.has("compact"))
    availableCommands.push({
      name: "compact",
      description: "compact the session",
    })

  const mcpServers: Record<string, ConfigMCP.Info> = {}
  for (const server of params.mcpServers) {
    if ("type" in server) {
      mcpServers[server.name] = {
        url: server.url,
        headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
          acc[name] = value
          return acc
        }, {}),
        type: "remote",
      }
    } else {
      mcpServers[server.name] = {
        type: "local",
        command: [server.command, ...server.args],
        environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
          acc[name] = value
          return acc
        }, {}),
      }
    }
  }

  await Promise.all(
    Object.entries(mcpServers).map(async ([key, mcp]) => {
      await agent.sdk.mcp
        .add(
          {
            directory,
            name: key,
            config: mcp,
          },
          { throwOnError: true },
        )
        .catch((error) => {
          log.error("failed to add mcp server", { name: key, error })
        })
    }),
  )

  setTimeout(() => {
    void agent.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands,
      },
    })
  }, 0)

  return {
    sessionId,
    models: {
      currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, false),
      availableModels,
    },
    modes,
    configOptions: buildConfigOptions({
      currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, false),
      availableModels,
      currentVariant,
      availableVariants,
      modes,
    }),
    _meta: buildVariantMeta({
      model,
      variant: agent.sessionManager.getVariant(sessionId),
      availableVariants,
    }),
  }
}
