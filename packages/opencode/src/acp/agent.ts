import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SetSessionModelRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk"

import * as Log from "@opencode-ai/core/util/log"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"
import { ACPRuntime } from "./runtime"
import { ModelID, ProviderID } from "../provider/schema"
import type { Event, OpencodeClient, SessionMessageResponse, ToolPart } from "@opencode-ai/sdk/v2"
import { ShellID } from "@/tool/shell/id"
import {
  type ModeOption,
  type ModelOption,
  defaultModel,
  toToolKind,
  sortProvidersByName,
  modelVariantsFromProviders,
  buildAvailableModels,
  formatModelIdWithVariant,
  buildVariantMeta,
  parseModelSelection,
  buildConfigOptions,
} from "./agent-helpers"
import { initialize as events_initialize, authenticate as events_authenticate, handleEvent as events_handleEvent } from "./agent-events"
import { newSession as sessions_newSession, loadSession as sessions_loadSession, listSessions as sessions_listSessions, unstable_forkSession as sessions_unstable_forkSession, resumeSession as sessions_resumeSession, closeSession as sessions_closeSession } from "./agent-sessions"
import { processMessage as message_processMessage } from "./agent-message"
import { loadSessionMode as mode_loadSessionMode } from "./agent-mode"
import { prompt as prompt_prompt, cancel as prompt_cancel } from "./agent-prompt"

const log = Log.create({ service: "acp-agent" })

export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
      return new Agent(connection, fullConfig)
    },
  }
}

export class Agent implements ACPAgent {
  readonly connection: AgentSideConnection
  readonly config: ACPConfig
  readonly sdk: OpencodeClient
  readonly sessionManager: ACPSessionManager
  private eventAbort = new AbortController()
  private eventStarted = false
  readonly shellSnapshots = new Map<string, string>()
  readonly toolStarts = new Set<string>()
  readonly permissionQueues = new Map<string, Promise<void>>()
  readonly permissionOptions: PermissionOption[] = [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ]

  constructor(connection: AgentSideConnection, config: ACPConfig) {
    this.connection = connection
    this.config = config
    this.sdk = config.sdk
    this.sessionManager = new ACPSessionManager(this.sdk)
    this.startEventSubscription()
  }

  private startEventSubscription() {
    if (this.eventStarted) return
    this.eventStarted = true
    this.runEventSubscription().catch((error) => {
      if (this.eventAbort.signal.aborted) return
      log.error("event subscription failed", { error })
    })
  }

  private async runEventSubscription() {
    while (true) {
      if (this.eventAbort.signal.aborted) return
      const events = await this.sdk.global.event({
        signal: this.eventAbort.signal,
      })
      for await (const event of events.stream) {
        if (this.eventAbort.signal.aborted) return
        const payload = event?.payload
        if (!payload) continue
        await this.handleEvent(payload as Event).catch((error) => {
          log.error("failed to handle event", { error, type: payload.type })
        })
      }
    }
  }

  private async handleEvent(event: Event) {
    return events_handleEvent(this, event)
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return events_initialize(this, params)
  }

  async authenticate(_params: AuthenticateRequest) {
    return events_authenticate(_params)
  }

  async newSession(params: NewSessionRequest) {
    return sessions_newSession(this, params)
  }

  async loadSession(params: LoadSessionRequest) {
    return sessions_loadSession(this, params)
  }

  async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return sessions_listSessions(this, params)
  }

  async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
    return sessions_unstable_forkSession(this, params)
  }

  async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
    return sessions_resumeSession(this, params)
  }

  async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
    return sessions_closeSession(this, params)
  }

  async processMessage(message: SessionMessageResponse) {
    return message_processMessage(this, message)
  }

  shellOutput(part: ToolPart) {
    if (part.tool !== ShellID.ToolID) return
    if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
    const output = part.state.metadata["output"]
    if (typeof output !== "string") return
    return output
  }

  async toolStart(sessionId: string, part: ToolPart) {
    if (this.toolStarts.has(part.callID)) return
    this.toolStarts.add(part.callID)
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: part.callID,
          title: part.tool,
          kind: toToolKind(part.tool),
          status: "pending",
          locations: [],
          rawInput: {},
        },
      })
      .catch((error) => {
        log.error("failed to send tool pending to ACP", { error })
      })
  }

  async loadAvailableModes(directory: string): Promise<ModeOption[]> {
    const agents = await this.config.sdk.app
      .agents(
        {
          directory,
        },
        { throwOnError: true },
      )
      .then((resp) => resp.data!)

    return agents
      .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
      .map((agent) => ({
        id: agent.name,
        name: agent.name,
        description: agent.description,
      }))
  }

  async resolveModeState(
    directory: string,
    sessionId: string,
  ): Promise<{ availableModes: ModeOption[]; currentModeId?: string }> {
    const availableModes = await this.loadAvailableModes(directory)
    const storedModeId = this.sessionManager.get(sessionId).modeId
    if (storedModeId && availableModes.some((mode) => mode.id === storedModeId)) {
      return { availableModes, currentModeId: storedModeId }
    }

    const currentModeId = await (async () => {
      if (!availableModes.length) return undefined
      const defaultAgent = await ACPRuntime.defaultAgentInfo(directory)
      const resolvedModeId = availableModes.find((mode) => mode.name === defaultAgent.name)?.id ?? availableModes[0].id
      this.sessionManager.setMode(sessionId, resolvedModeId)
      return resolvedModeId
    })()

    return { availableModes, currentModeId }
  }

  async loadSessionMode(params: LoadSessionRequest) {
    return mode_loadSessionMode(this, params)
  }

  async unstable_setSessionModel(params: SetSessionModelRequest) {
    const session = this.sessionManager.get(params.sessionId)
    const providers = await this.sdk.config
      .providers({ directory: session.cwd }, { throwOnError: true })
      .then((x) => x.data!.providers)

    const selection = parseModelSelection(params.modelId, providers)
    this.sessionManager.setModel(session.id, selection.model)
    this.sessionManager.setVariant(session.id, selection.variant)

    const entries = sortProvidersByName(providers)
    const availableVariants = modelVariantsFromProviders(entries, selection.model)
    const modeState = await this.resolveModeState(session.cwd, session.id)
    const modes = modeState.currentModeId
      ? { availableModes: modeState.availableModes, currentModeId: modeState.currentModeId }
      : undefined

    await this.connection.sessionUpdate({
      sessionId: session.id,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: buildConfigOptions({
          currentModelId: formatModelIdWithVariant(selection.model, selection.variant, availableVariants, false),
          availableModels: buildAvailableModels(entries),
          currentVariant: selection.variant,
          availableVariants,
          modes,
        }),
      },
    })

    return {
      _meta: buildVariantMeta({
        model: selection.model,
        variant: selection.variant,
        availableVariants,
      }),
    }
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
    const session = this.sessionManager.get(params.sessionId)
    const availableModes = await this.loadAvailableModes(session.cwd)
    if (!availableModes.some((mode) => mode.id === params.modeId)) {
      throw new Error(`Agent not found: ${params.modeId}`)
    }
    this.sessionManager.setMode(params.sessionId, params.modeId)
  }

  async setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    const session = this.sessionManager.get(params.sessionId)
    const providers = await this.sdk.config
      .providers({ directory: session.cwd }, { throwOnError: true })
      .then((x) => x.data!.providers)
    const entries = sortProvidersByName(providers)

    if (params.configId === "model") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("model value must be a string")
      const selection = parseModelSelection(params.value, providers)
      this.sessionManager.setModel(session.id, selection.model)
      this.sessionManager.setVariant(session.id, selection.variant)
    } else if (params.configId === "effort") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("effort value must be a string")
      const current = session.model ?? (await defaultModel(this.config, session.cwd))
      const availableVariants = modelVariantsFromProviders(entries, current)
      if (!availableVariants.includes(params.value)) {
        throw RequestError.invalidParams(JSON.stringify({ error: `Effort not found: ${params.value}` }))
      }
      this.sessionManager.setVariant(session.id, params.value)
    } else if (params.configId === "mode") {
      if (typeof params.value !== "string") throw RequestError.invalidParams("mode value must be a string")
      const availableModes = await this.loadAvailableModes(session.cwd)
      if (!availableModes.some((mode) => mode.id === params.value)) {
        throw RequestError.invalidParams(JSON.stringify({ error: `Mode not found: ${params.value}` }))
      }
      this.sessionManager.setMode(session.id, params.value)
    } else {
      throw RequestError.invalidParams(JSON.stringify({ error: `Unknown config option: ${params.configId}` }))
    }

    const updatedSession = this.sessionManager.get(session.id)
    const model = updatedSession.model ?? (await defaultModel(this.config, session.cwd))
    const availableVariants = modelVariantsFromProviders(entries, model)
    const currentModelId = formatModelIdWithVariant(model, updatedSession.variant, availableVariants, false)
    const availableModels = buildAvailableModels(entries)
    const modeState = await this.resolveModeState(session.cwd, session.id)
    const modes = modeState.currentModeId
      ? { availableModes: modeState.availableModes, currentModeId: modeState.currentModeId }
      : undefined

    return {
      configOptions: buildConfigOptions({
        currentModelId,
        availableModels,
        currentVariant: updatedSession.variant,
        availableVariants,
        modes,
      }),
    }
  }

  async prompt(params: PromptRequest) {
    return prompt_prompt(this, params)
  }

  async cancel(params: CancelNotification) {
    return prompt_cancel(this, params)
  }
}

export * as ACP from "./agent"
