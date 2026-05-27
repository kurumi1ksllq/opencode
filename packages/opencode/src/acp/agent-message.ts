import { type PlanEntry, type Role, type ToolCallContent } from "@agentclientprotocol/sdk"
import * as Log from "@opencode-ai/core/util/log"
import { pathToFileURL } from "url"
import { Result, Schema } from "effect"
import { Todo } from "@/session/todo"
import type { SessionMessageResponse } from "@opencode-ai/sdk/v2"
import type { Agent } from "./agent"
import { toToolKind, toLocations, completedToolContent, completedToolRawOutput } from "./agent-helpers"

const decodeTodos = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Array(Todo.Info)))
const log = Log.create({ service: "acp-agent" })

export async function processMessage(agent: Agent, message: SessionMessageResponse) {
  log.debug("process message", message)
  if (message.info.role !== "assistant" && message.info.role !== "user") return
  const sessionId = message.info.sessionID

  for (const part of message.parts) {
    if (part.type === "tool") {
      await agent.toolStart(sessionId, part)
      switch (part.state.status) {
        case "pending":
          agent.shellSnapshots.delete(part.callID)
          break
        case "running":
          const output = agent.shellOutput(part)
          const runningContent: ToolCallContent[] = []
          if (output) {
            runningContent.push({
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
                ...(runningContent.length > 0 && { content: runningContent }),
              },
            })
            .catch((err) => {
              log.error("failed to send tool in_progress to ACP", { error: err })
            })
          break
        case "completed":
          agent.toolStarts.delete(part.callID)
          agent.shellSnapshots.delete(part.callID)
          const kind = toToolKind(part.tool)
          const content = completedToolContent(part, kind)

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
                .catch((err) => {
                  log.error("failed to send session update for todo", { error: err })
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
                content,
                title: part.state.title,
                rawInput: part.state.input,
                rawOutput: completedToolRawOutput(part),
              },
            })
            .catch((err) => {
              log.error("failed to send tool completed to ACP", { error: err })
            })
          break
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
            .catch((err) => {
              log.error("failed to send tool error to ACP", { error: err })
            })
          break
      }
    } else if (part.type === "text") {
      if (part.text) {
        const audience: Role[] | undefined = part.synthetic ? ["assistant"] : part.ignored ? ["user"] : undefined
        await agent.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
              messageId: message.info.id,
              content: {
                type: "text",
                text: part.text,
                ...(audience && { annotations: { audience } }),
              },
            },
          })
          .catch((err) => {
            log.error("failed to send text to ACP", { error: err })
          })
      }
    } else if (part.type === "file") {
      // Replay file attachments as appropriate ACP content blocks.
      // OpenCode stores files internally as { type: "file", url, filename, mime }.
      // We convert these back to ACP blocks based on the URL scheme and MIME type:
      // - file:// URLs → resource_link
      // - data: URLs with image/* → image block
      // - data: URLs with text/* or application/json → resource with text
      // - data: URLs with other types → resource with blob
      const url = part.url
      const filename = part.filename ?? "file"
      const mime = part.mime || "application/octet-stream"
      const messageChunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"

      if (url.startsWith("file://")) {
        // Local file reference - send as resource_link
        await agent.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: messageChunk,
              messageId: message.info.id,
              content: { type: "resource_link", uri: url, name: filename, mimeType: mime },
            },
          })
          .catch((err) => {
            log.error("failed to send resource_link to ACP", { error: err })
          })
      } else if (url.startsWith("data:")) {
        // Embedded content - parse data URL and send as appropriate block type
        const base64Match = url.match(/^data:([^;]+);base64,(.*)$/)
        const dataMime = base64Match?.[1]
        const base64Data = base64Match?.[2] ?? ""

        const effectiveMime = dataMime || mime

        if (effectiveMime.startsWith("image/")) {
          // Image - send as image block
          await agent.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: messageChunk,
                messageId: message.info.id,
                content: {
                  type: "image",
                  mimeType: effectiveMime,
                  data: base64Data,
                  uri: pathToFileURL(filename).href,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send image to ACP", { error: err })
            })
        } else {
          // Non-image: text types get decoded, binary types stay as blob
          const isText = effectiveMime.startsWith("text/") || effectiveMime === "application/json"
          const fileUri = pathToFileURL(filename).href
          const resource = isText
            ? {
                uri: fileUri,
                mimeType: effectiveMime,
                text: Buffer.from(base64Data, "base64").toString("utf-8"),
              }
            : { uri: fileUri, mimeType: effectiveMime, blob: base64Data }

          await agent.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: messageChunk,
                messageId: message.info.id,
                content: { type: "resource", resource },
              },
            })
            .catch((err) => {
              log.error("failed to send resource to ACP", { error: err })
            })
        }
      }
      // URLs that don't match file:// or data: are skipped (unsupported)
    } else if (part.type === "reasoning") {
      if (part.text) {
        await agent.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              messageId: message.info.id,
              content: {
                type: "text",
                text: part.text,
              },
            },
          })
          .catch((err) => {
            log.error("failed to send reasoning to ACP", { error: err })
          })
      }
    }
  }
}
