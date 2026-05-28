import * as Log from "@opencode-ai/core/util/log"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { ulid } from "ulid"
import { TaskTool } from "@/tool/task"
import type { Interface as AgentInterface } from "../agent/agent"
import type { Provider } from "@/provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Cause, Effect } from "effect"
import { Permission } from "@/permission"

const log = Log.create({ service: "session.prompt" })

export interface HandleSubtaskServices {
  readonly sessions: Session.Interface
  readonly agents: AgentInterface
  readonly registry: any
  readonly bus: any
  readonly plugin: any
  readonly permission: any
}

export interface HandleSubtaskHelpers {
  readonly ops: () => Effect.Effect<any>
  readonly getModel: (providerID: ProviderID, modelID: ModelID, sessionID: SessionID) => Effect.Effect<Provider.Model>
}

export interface HandleSubtaskInput {
  task: MessageV2.SubtaskPart
  model: Provider.Model
  lastUser: MessageV2.User
  sessionID: SessionID
  session: Session.Info
  msgs: MessageV2.WithParts[]
}

export const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (
  input: HandleSubtaskInput,
  helpers: HandleSubtaskHelpers,
  services: HandleSubtaskServices,
  ctx: { directory: string; worktree: string },
) {
  const { task, model, lastUser, sessionID, session, msgs } = input
  const { ops, getModel } = helpers
  const { sessions, agents, registry, bus, plugin, permission } = services
  const promptOps = yield* ops()
  const { task: taskTool } = yield* registry.named()
  const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
  const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: lastUser.model.variant,
    path: { cwd: ctx.directory, root: ctx.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: { created: Date.now() },
  })
  let part: MessageV2.ToolPart = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: { start: Date.now() },
    },
  })
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  yield* plugin.trigger(
    "tool.execute.before",
    { tool: TaskTool.id, sessionID, callID: part.id },
    { args: taskArgs },
  )

  const taskAgent = yield* agents.get(task.agent)
  if (!taskAgent) {
    const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
    yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
    return yield* Effect.fail(error)
  }

  let error: Error | undefined
  const taskAbort = new AbortController()
  const result = yield* taskTool
    .execute(taskArgs, {
      agent: task.agent,
      messageID: assistantMessage.id,
      sessionID,
      abort: taskAbort.signal,
      callID: part.callID,
      extra: { bypassAgentCheck: true, promptOps },
      messages: msgs,
      metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
        Effect.gen(function* () {
          part = yield* sessions.updatePart({
            ...part,
            type: "tool",
            state: { ...part.state, ...val },
          } satisfies MessageV2.ToolPart)
        }),
      ask: (req: any) =>
        permission
          .ask({
            ...req,
            sessionID,
            ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
          })
          .pipe(Effect.orDie),
    })
    .pipe(
      Effect.catchCause((cause: any) => {
        const defect = Cause.squash(cause)
        error = defect instanceof Error ? defect : new Error(String(defect))
        log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
        return Effect.void
      }),
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          taskAbort.abort()
          assistantMessage.finish = "tool-calls"
          assistantMessage.time.completed = Date.now()
          yield* sessions.updateMessage(assistantMessage)
          if (part.state.status === "running") {
            yield* sessions.updatePart({
              ...part,
              state: {
                status: "error",
                error: "Cancelled",
                time: { start: part.state.time.start, end: Date.now() },
                metadata: part.state.metadata,
                input: part.state.input,
              },
            } satisfies MessageV2.ToolPart)
          }
        }),
      ),
    )

  const attachments = result?.attachments?.map((attachment: any) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))

  yield* plugin.trigger(
    "tool.execute.after",
    { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
    result,
  )

  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
  yield* sessions.updateMessage(assistantMessage)

  if (result && part.state.status === "running") {
    yield* sessions.updatePart({
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: { ...part.state.time, end: Date.now() },
      },
    } satisfies MessageV2.ToolPart)
  }

  if (!result) {
    yield* sessions.updatePart({
      ...part,
      state: {
        status: "error",
        error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: part.state.status === "pending" ? undefined : part.state.metadata,
        input: part.state.input,
      },
    } satisfies MessageV2.ToolPart)
  }

  if (!task.command) return

  const summaryUserMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: lastUser.agent,
    model: lastUser.model,
  }
  yield* sessions.updateMessage(summaryUserMsg)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: summaryUserMsg.id,
    sessionID,
    type: "text",
    text: "Summarize the task tool output above and continue with your task.",
    synthetic: true,
  } satisfies MessageV2.TextPart)
})
