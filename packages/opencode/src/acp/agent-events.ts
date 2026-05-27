import { RequestError, type Agent as ACPAgent, type AuthMethod, type AuthenticateRequest, type InitializeRequest, type InitializeResponse, type PlanEntry, type PermissionOption, type ToolCallContent } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import { Hash } from "@opencode-ai/core/util/hash"
import type { Event } from "@opencode-ai/sdk/v2"
import { Result, Schema } from "effect"
import { Todo } from "@/session/todo"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ShellID } from "@/tool/shell/id"
import type { Agent } from "./agent"
import { toToolKind, toLocations, completedToolContent, completedToolRawOutput, getNewContent } from "./agent-helpers"
import { MessageV2 } from "@/session/message-v2"
import { ProviderID } from "../provider/schema"

const decodeTodos = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Todo.Info)))
const log = Log.create({ service: "acp-agent" })

export async function initialize(agent: Agent, params: InitializeRequest): Promise<InitializeResponse> {
  log.info("initialize", { protocolVersion: params.protocolVersion })

  const authMethod: AuthMethod = {
    description: "Run `opencode auth login` in the terminal",
    name: "Login with opencode",
    id: "opencode-login",
  }

  // If client supports terminal-auth capability, use that instead.
  if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
    authMethod._meta = {
      "terminal-auth": {
        command: "opencode",
        args: ["auth", "login"],
        label: "OpenCode Login",
      },
    }
  }

  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: {
        http: true,
        sse: true,
      },
      promptCapabilities: {
        embeddedContext: true,
        image: true,
      },
      sessionCapabilities: {
        close: {},
        fork: {},
        list: {},
        resume: {},
      },
    },
    authMethods: [authMethod],
    agentInfo: {
      name: "OpenCode",
      version: InstallationVersion,
    },
  }
}

export async function authenticate(_params: AuthenticateRequest) {
  throw new Error("Authentication not implemented")
}

export async function handleEvent(agent: Agent, event: Event) {
  switch (event.type) {
    case "permission.asked": {
      const permission = event.properties
      const session = agent.sessionManager.tryGet(permission.sessionID)
      if (!session) return

      const prev = agent.permissionQueues.get(permission.sessionID) ?? Promise.resolve()
      const next = prev
        .then(async () => {
          const directory = session.cwd

          const res = await agent.connection
            .requestPermission({
              sessionId: permission.sessionID,
              toolCall: {
                toolCallId: permission.tool?.callID ?? permission.id,
                status: "pending",
                title: permission.permission,
                rawInput: permission.metadata,
                kind: toToolKind(permission.permission),
                locations: toLocations(permission.permission, permission.metadata),
              },
              options: agent.permissionOptions,
            })
            .catch(async (error) => {
              log.error("failed to request permission from ACP", {
                error,
                permissionID: permission.id,
                sessionID: permission.sessionID,
              })
              await agent.sdk.permission.reply({
                requestID: permission.id,
                reply: "reject",
                directory,
              })
              return undefined
            })

          if (!res) return
          if (res.outcome.outcome !== "selected") {
            await agent.sdk.permission.reply({
              requestID: permission.id,
              reply: "reject",
              directory,
            })
            return
          }

          if (res.outcome.optionId !== "reject" && permission.permission == "edit") {
            const metadata = permission.metadata || {}
            const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
            const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""
            const content = (await Filesystem.exists(filepath)) ? await Filesystem.readText(filepath) : ""
            const newContent = getNewContent(content, diff)

            if (newContent) {
              void agent.connection.writeTextFile({
                sessionId: session.id,
                path: filepath,
                content: newContent,
              })
            }
          }

          await agent.sdk.permission.reply({
            requestID: permission.id,
            reply: res.outcome.optionId as "once" | "always" | "reject",
            directory,
          })
        })
        .catch((error) => {
          log.error("failed to handle permission", { error, permissionID: permission.id })
        })
        .finally(() => {
          if (agent.permissionQueues.get(permission.sessionID) === next) {
            agent.permissionQueues.delete(permission.sessionID)
          }
        })
      agent.permissionQueues.set(permission.sessionID, next)
      return
    }

    case "message.part.updated": {
      log.info("message part updated", { event: event.properties })
      const props = event.properties
      const part = props.part
      const session = agent.sessionManager.tryGet(part.sessionID)
      if (!session) return
      const sessionId = session.id

      if (part.type === "tool") {
        await agent.toolStart(sessionId, part)

        switch (part.state.status) {
          case "pending":
            agent.shellSnapshots.delete(part.callID)
            return

          case "running":
            const output = agent.shellOutput(part)
            const content: ToolCallContent[] = []
            if (output) {
              const hash = Hash.fast(output)
              if (part.tool === ShellID.ToolID) {
                if (agent.shellSnapshots.get(part.callID) === hash) {
                  await agent.connection
                    .sessionUpdate({
                      sessionId,
                      update: {
                        sessionUpdate: "tool_call_update",
                        toolCallId: part.callID,
                        status: "in_progress",
                        kind: toToolKind(part.tool),
                        title: part.tool,
                        locations: toLocations(part.tool, part.state.input),
                        rawInput: part.state.input,
                      },
                    })
                    .catch((error) => {
                      log.error("failed to send tool in_progress to ACP", { error })
                    })
                  return
                }
                agent.shellSnapshots.set(part.callID, hash)
              }
              content.push({
                type: "content",
                content: {
                  type: "text",
                  text: output,
                },
              })
            }
            await agent.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "in_progress",
                  kind: toToolKind(part.tool),
                  title: part.tool,
                  locations: toLocations(part.tool, part.state.input),
                  rawInput: part.state.input,
                  ...(content.length > 0 && { content }),
                },
              })
              .catch((error) => {
                log.error("failed to send tool in_progress to ACP", { error })
              })
            return

          case "completed": {
            agent.toolStarts.delete(part.callID)
            agent.shellSnapshots.delete(part.callID)
            const kind = toToolKind(part.tool)
            const toolContent = completedToolContent(part, kind)

            if (part.tool === "todowrite") {
              const parsedTodos = decodeTodos(part.state.output)
              if (Result.isSuccess(parsedTodos)) {
                await agent.connection
                  .sessionUpdate({
                    sessionId,
                    update: {
                      sessionUpdate: "plan",
                      entries: parsedTodos.success.map((todo) => {
                        const status: PlanEntry["status"] =
                          todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                        return {
                          priority: "medium",
                          status,
                          content: todo.content,
                        }
                      }),
                    },
                  })
                  .catch((error) => {
                    log.error("failed to send session update for todo", { error })
                  })
              } else {
                log.error("failed to parse todo output", { error: parsedTodos.failure })
              }
            }

            await agent.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "completed",
                  kind,
                  content: toolContent,
                  title: part.state.title,
                  rawInput: part.state.input,
                  rawOutput: completedToolRawOutput(part),
                },
              })
              .catch((error) => {
                log.error("failed to send tool completed to ACP", { error })
              })
            return
          }
          case "error":
            agent.toolStarts.delete(part.callID)
            agent.shellSnapshots.delete(part.callID)
            await agent.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "failed",
                  kind: toToolKind(part.tool),
                  title: part.tool,
                  rawInput: part.state.input,
                  content: [
                    {
                      type: "content",
                      content: {
                        type: "text",
                        text: part.state.error,
                      },
                    },
                  ],
                  rawOutput: {
                    error: part.state.error,
                    metadata: part.state.metadata,
                  },
                },
              })
              .catch((error) => {
                log.error("failed to send tool error to ACP", { error })
              })
            return
        }
      }

      // ACP clients already know the prompt they just submitted, so replaying
      // live user parts duplicates the message. We still replay user history in
      // loadSession() and forkSession() via processMessage().
      if (part.type !== "text" && part.type !== "file") return

      return
    }

    case "message.part.delta": {
      const props = event.properties
      const session = agent.sessionManager.tryGet(props.sessionID)
      if (!session) return
      const sessionId = session.id

      const message = await agent.sdk.session
        .message(
          {
            sessionID: props.sessionID,
            messageID: props.messageID,
            directory: session.cwd,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)
        .catch((error) => {
          log.error("unexpected error when fetching message", { error })
          return undefined
        })

      if (!message || message.info.role !== "assistant") return

      const part = message.parts.find((p) => p.id === props.partID)
      if (!part) return

      if (part.type === "text" && props.field === "text" && part.ignored !== true) {
        await agent.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: props.messageID,
              content: {
                type: "text",
                text: props.delta,
              },
            },
          })
          .catch((error) => {
            log.error("failed to send text delta to ACP", { error })
          })
        return
      }

      if (part.type === "reasoning" && props.field === "text") {
        await agent.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              messageId: props.messageID,
              content: {
                type: "text",
                text: props.delta,
              },
            },
          })
          .catch((error) => {
            log.error("failed to send reasoning delta to ACP", { error })
          })
      }
      return
    }
  }
}
