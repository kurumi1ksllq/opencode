import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionID, MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import type { LoopInput } from "./prompt-schemas"
import { createStructuredOutputTool } from "./prompt-schemas"
import * as Session from "./session"
import { SessionCompaction } from "./compaction"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import type { TaskPromptOps } from "@/tool/task"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import type { Provider } from "@/provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Cause, Effect } from "effect"
import type { Interface as SessionRunStateInterface } from "./run-state"
import type { Interface as SessionStatusInterface } from "./status"
import type { Interface as CompactionInterface } from "./compaction"
import type { Interface as ProcessorInterface } from "./processor"
import type { Interface as SummaryInterface } from "./summary"
import type { Interface as InstructionInterface } from "./instruction"
import type { Interface as SystemPromptInterface } from "./system"
import type { Interface as AgentInterface } from "../agent/agent"
import type { Interface as BusInterface } from "../bus"
import type { Interface as PluginInterface } from "../plugin"
import { Plugin } from "../plugin"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { Truncate } from "@/tool/truncate"

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const elog = EffectLogger.create({ service: "session.prompt" })

export interface RunLoopServices {
  readonly sessions: Session.Interface
  readonly status: SessionStatusInterface
  readonly scope: any
  readonly compaction: CompactionInterface
  readonly agents: AgentInterface
  readonly bus: BusInterface
  readonly flags: any
  readonly fsys: any
  readonly processor: ProcessorInterface
  readonly plugin: PluginInterface
  readonly permission: any
  readonly registry: any
  readonly mcp: any
  readonly truncate: any
  readonly summary: SummaryInterface
  readonly instruction: InstructionInterface
  readonly sys: SystemPromptInterface
  readonly state: SessionRunStateInterface
}

export interface RunLoopHelpers {
  readonly title: (input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: ProviderID
    modelID: ModelID
  }) => Effect.Effect<void, any>
  readonly getModel: (
    providerID: ProviderID,
    modelID: ModelID,
    sessionID: SessionID,
  ) => Effect.Effect<Provider.Model, any>
  readonly handleSubtask: (input: {
    task: MessageV2.SubtaskPart
    model: Provider.Model
    lastUser: MessageV2.User
    sessionID: SessionID
    session: Session.Info
    msgs: MessageV2.WithParts[]
  }) => Effect.Effect<void, any>
  readonly ops: () => Effect.Effect<TaskPromptOps, any>
  readonly lastAssistant: (sessionID: SessionID) => Effect.Effect<MessageV2.WithParts, any>
}

export const runLoop = Effect.fn("SessionPrompt.run")(function* (
  sessionID: SessionID,
  helpers: RunLoopHelpers,
  services: RunLoopServices,
  ctx: { directory: string; worktree: string },
) {
  const { title, getModel, handleSubtask, ops, lastAssistant } = helpers
  const { sessions, status, compaction, scope, instruction } = services
  const slog = elog.with({ sessionID })
  let structured: unknown
  let step = 0
  const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

  while (true) {
    yield* status.set(sessionID, { type: "busy" })
    yield* slog.info("loop", { step })

    let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

    const { user: lastUser, assistant: lastAssistantVal, finished: lastFinished, tasks } = MessageV2.latest(msgs)

    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

    const lastAssistantMsg = msgs.findLast(
      (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistantVal?.id,
    )
    // Some providers return "stop" even when the assistant message contains tool calls.
    // Keep the loop running so tool results can be sent back to the model.
    // Skip provider-executed tool parts — those were fully handled within the
    // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
    const hasToolCalls =
      lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

    if (
      lastAssistantVal?.finish &&
      !["tool-calls"].includes(lastAssistantVal.finish) &&
      !hasToolCalls &&
      lastUser.id < lastAssistantVal.id
    ) {
      yield* slog.info("exiting loop")
      break
    }

    step++
    if (step === 1)
      yield* title({
        session,
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        history: msgs,
      }).pipe(Effect.ignore, Effect.forkIn(scope))

    const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
    const task = tasks.pop()

    if (task?.type === "subtask") {
      yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
      continue
    }

    if (task?.type === "compaction") {
      const result = yield* compaction.process({
        messages: msgs,
        parentID: lastUser.id,
        sessionID,
        auto: task.auto,
        overflow: task.overflow,
      })
      if (result === "stop") break
      continue
    }

    if (
      lastFinished &&
      lastFinished.summary !== true &&
      (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
    ) {
      yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
      continue
    }

    const { agents, bus, fsys } = services
    const agent = yield* agents.get(lastUser.agent)
    if (!agent) {
      const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
      yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
      throw error
    }
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = step >= maxSteps
    const { flags } = services
    msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
      Effect.provideService(RuntimeFlags.Service, flags),
      Effect.provideService(Session.Service, sessions),
      Effect.provideService(AppFileSystem.Service, fsys),
    )

    const msg: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: lastUser.id,
      role: "assistant",
      mode: agent.name,
      agent: agent.name,
      variant: lastUser.model.variant,
      path: { cwd: ctx.directory, root: ctx.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID,
    }
    yield* sessions.updateMessage(msg)

    const finalizeInterruptedAssistant = Effect.gen(function* () {
      if (msg.time.completed) return
      msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
        providerID: msg.providerID,
        aborted: true,
      })
      msg.time.completed = Date.now()
      yield* sessions.updateMessage(msg)
    })

    const { processor } = services
    const handle = yield* processor
      .create({
        assistantMessage: msg,
        sessionID,
        model,
      })
      .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

    const outcome: "break" | "continue" = yield* Effect.gen(function* () {
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
      const promptOps = yield* ops()

      const { plugin, permission, registry, mcp, truncate } = services

      const tools = yield* SessionTools.resolve({
        agent,
        session,
        model,
        processor: handle,
        bypassAgentCheck,
        messages: msgs,
        promptOps,
      }).pipe(
        Effect.provideService(Plugin.Service, plugin),
        Effect.provideService(Permission.Service, permission),
        Effect.provideService(ToolRegistry.Service, registry),
        Effect.provideService(MCP.Service, mcp),
        Effect.provideService(Truncate.Service, truncate),
      )

      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structured = output
          },
        })
      }

      if (step === 1) {
        const { summary } = services
        yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))
      }

      if (step > 1 && lastFinished) {
        for (const m of msgs) {
          if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
          for (const p of m.parts) {
            if (p.type !== "text" || p.ignored || p.synthetic) continue
            if (!p.text.trim()) continue
            p.text = [
              "<system-reminder>",
              "The user sent the following message:",
              p.text,
              "",
              "Please address this message and continue with your tasks.",
              "</system-reminder>",
            ].join("\n")
          }
        }
      }

      yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

      const { sys } = services
      const [skills, env, instructions, modelMsgs] = yield* Effect.all([
        sys.skills(agent),
        sys.environment(model),
        instruction.system().pipe(Effect.orDie),
        MessageV2.toModelMessagesEffect(msgs, model),
      ])
      const system = [...(env as string[]), ...(instructions as string[]), ...(skills ? [skills as string] : [])]
      const format = lastUser.format ?? { type: "text" as const }
      if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
      const result = yield* handle.process({
        user: lastUser,
        agent,
        permission: session.permission,
        sessionID,
        parentSessionID: session.parentID,
        system,
        messages: [...(modelMsgs as any[]), ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
      })

      if (structured !== undefined) {
        handle.message.structured = structured
        handle.message.finish = handle.message.finish ?? "stop"
        yield* sessions.updateMessage(handle.message)
        return "break" as const
      }

      const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
      if (finished && !handle.message.error) {
        if (format.type === "json_schema") {
          handle.message.error = new MessageV2.StructuredOutputError({
            message: "Model did not produce structured output",
            retries: 0,
          }).toObject()
          yield* sessions.updateMessage(handle.message)
          return "break" as const
        }
      }

      if (result === "stop") return "break" as const
      if (result === "compact") {
        yield* compaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: !handle.message.finish,
        })
      }
      return "continue" as const
    }).pipe(
      Effect.ensuring(instruction.clear(handle.message.id)),
      Effect.onInterrupt(() => finalizeInterruptedAssistant),
    )
    if (outcome === "break") break
    continue
  }

  yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
  return yield* lastAssistant(sessionID)
})

export const loop: (
  input: LoopInput,
  helpers: RunLoopHelpers,
  services: RunLoopServices,
  ctx: { directory: string; worktree: string },
) => Effect.Effect<MessageV2.WithParts> = (input, helpers, services, ctx) =>
  services.state.ensureRunning(
    input.sessionID,
    helpers.lastAssistant(input.sessionID).pipe(Effect.orDie) as Effect.Effect<MessageV2.WithParts>,
    runLoop(input.sessionID, helpers, services, ctx) as Effect.Effect<MessageV2.WithParts>,
  )
