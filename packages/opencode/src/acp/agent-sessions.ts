import { RequestError, type CloseSessionRequest, type CloseSessionResponse, type ForkSessionRequest, type ForkSessionResponse, type ListSessionsRequest, type ListSessionsResponse, type LoadSessionRequest, type NewSessionRequest, type ResumeSessionRequest, type ResumeSessionResponse, type SessionInfo } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { MessageV2 } from "@/session/message-v2"
import { ModelID, ProviderID } from "../provider/schema"
import { LoadAPIKeyError } from "ai"
import type { SessionMessageResponse } from "@opencode-ai/sdk/v2"
import type { Agent } from "./agent"
import { defaultModel, sendUsageUpdate } from "./agent-helpers"

const log = Log.create({ service: "acp-agent" })

export async function newSession(agent: Agent, params: NewSessionRequest) {
  const directory = params.cwd
  try {
    const model = await defaultModel(agent.config, directory)

    // Store ACP session state
    const state = await agent.sessionManager.create(params.cwd, params.mcpServers, model)
    const sessionId = state.id

    log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })

    const load = await agent.loadSessionMode({
      cwd: directory,
      mcpServers: params.mcpServers,
      sessionId,
    })

    return {
      sessionId,
      configOptions: load.configOptions,
      models: load.models,
      modes: load.modes,
      _meta: load._meta,
    }
  } catch (e) {
    const error = MessageV2.fromError(e, {
      providerID: ProviderID.make(agent.config.defaultModel?.providerID ?? "unknown"),
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw e
  }
}

export async function loadSession(agent: Agent, params: LoadSessionRequest) {
  const directory = params.cwd
  const sessionId = params.sessionId

  try {
    const model = await defaultModel(agent.config, directory)

    // Store ACP session state
    await agent.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)

    const messages = await loadSessionMessages(agent, directory, sessionId)
    restoreSessionStateFromMessages(agent, sessionId, messages)

    log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })

    const result = await agent.loadSessionMode({
      cwd: directory,
      mcpServers: params.mcpServers,
      sessionId,
    })

    for (const msg of messages ?? []) {
      log.debug("replay message", msg)
      await agent.processMessage(msg)
    }

    await sendUsageUpdate(agent.connection, agent.sdk, sessionId, directory)

    return result
  } catch (e) {
    const error = MessageV2.fromError(e, {
      providerID: ProviderID.make(agent.config.defaultModel?.providerID ?? "unknown"),
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw e
  }
}

export async function listSessions(agent: Agent, params: ListSessionsRequest): Promise<ListSessionsResponse> {
  try {
    const cursor = params.cursor ? Number(params.cursor) : undefined
    const limit = 100

    const sessions = await agent.sdk.session
      .list(
        {
          directory: params.cwd ?? undefined,
          roots: true,
        },
        { throwOnError: true },
      )
      .then((x) => x.data ?? [])

    const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
    const filtered = cursor ? sorted.filter((s) => s.time.updated < cursor) : sorted
    const page = filtered.slice(0, limit)

    const entries: SessionInfo[] = page.map((session) => ({
      sessionId: session.id,
      cwd: session.directory,
      title: session.title,
      updatedAt: new Date(session.time.updated).toISOString(),
    }))

    const last = page[page.length - 1]
    const next = filtered.length > limit && last ? String(last.time.updated) : undefined

    const response: ListSessionsResponse = {
      sessions: entries,
    }
    if (next) response.nextCursor = next
    return response
  } catch (e) {
    const error = MessageV2.fromError(e, {
      providerID: ProviderID.make(agent.config.defaultModel?.providerID ?? "unknown"),
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw e
  }
}

export async function unstable_forkSession(agent: Agent, params: ForkSessionRequest): Promise<ForkSessionResponse> {
  const directory = params.cwd
  const mcpServers = params.mcpServers ?? []

  try {
    const model = await defaultModel(agent.config, directory)

    const forked = await agent.sdk.session
      .fork(
        {
          sessionID: params.sessionId,
          directory,
        },
        { throwOnError: true },
      )
      .then((x) => x.data)

    if (!forked) {
      throw new Error("Fork session returned no data")
    }

    const sessionId = forked.id
    await agent.sessionManager.load(sessionId, directory, mcpServers, model)

    const messages = await loadSessionMessages(agent, directory, sessionId)
    restoreSessionStateFromMessages(agent, sessionId, messages)

    log.info("fork_session", { sessionId, mcpServers: mcpServers.length })

    const mode = await agent.loadSessionMode({
      cwd: directory,
      mcpServers,
      sessionId,
    })

    for (const msg of messages ?? []) {
      log.debug("replay message", msg)
      await agent.processMessage(msg)
    }

    await sendUsageUpdate(agent.connection, agent.sdk, sessionId, directory)

    return mode
  } catch (e) {
    const error = MessageV2.fromError(e, {
      providerID: ProviderID.make(agent.config.defaultModel?.providerID ?? "unknown"),
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw e
  }
}

export async function resumeSession(agent: Agent, params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
  const directory = params.cwd
  const sessionId = params.sessionId
  const mcpServers = params.mcpServers ?? []

  try {
    const model = await defaultModel(agent.config, directory)
    await agent.sessionManager.load(sessionId, directory, mcpServers, model)

    const messages = await loadSessionMessages(agent, directory, sessionId, 20)
    restoreSessionStateFromMessages(agent, sessionId, messages)

    log.info("resume_session", { sessionId, mcpServers: mcpServers.length })

    const result = await agent.loadSessionMode({
      cwd: directory,
      mcpServers,
      sessionId,
    })

    await sendUsageUpdate(agent.connection, agent.sdk, sessionId, directory)

    return result
  } catch (e) {
    const error = MessageV2.fromError(e, {
      providerID: ProviderID.make(agent.config.defaultModel?.providerID ?? "unknown"),
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw e
  }
}

export async function closeSession(agent: Agent, params: CloseSessionRequest): Promise<CloseSessionResponse> {
  const session = agent.sessionManager.remove(params.sessionId)
  if (!session) return {}

  await agent.sdk.session
    .abort(
      {
        sessionID: params.sessionId,
        directory: session.cwd,
      },
      { throwOnError: true },
    )
    .catch((error) => {
      log.error("failed to abort session while closing ACP session", { error, sessionID: params.sessionId })
    })

  agent.permissionQueues.delete(params.sessionId)
  log.info("close_session", { sessionId: params.sessionId })
  return {}
}

export async function loadSessionMessages(
  agent: Agent,
  directory: string,
  sessionId: string,
  limit?: number,
) {
  return agent.sdk.session
    .messages(
      {
        sessionID: sessionId,
        directory,
        limit,
      },
      { throwOnError: true },
    )
    .then((x) => x.data)
    .catch((error) => {
      log.error("unexpected error when fetching message", { error })
      return undefined
    })
}

export function restoreSessionStateFromMessages(
  agent: Agent,
  sessionId: string,
  messages: SessionMessageResponse[] | undefined,
) {
  const lastUser = messages?.findLast((message) => message.info.role === "user")?.info
  if (lastUser?.role !== "user") return

  agent.sessionManager.setModel(sessionId, {
    providerID: ProviderID.make(lastUser.model.providerID),
    modelID: ModelID.make(lastUser.model.modelID),
  })
  agent.sessionManager.setVariant(sessionId, lastUser.model.variant)
  if (lastUser.agent) {
    agent.sessionManager.setMode(sessionId, lastUser.agent)
  }
}
