import path from "path"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { LLM } from "./llm"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Cause, Effect, Exit, Layer, Option, Scope, Schema, Types } from "effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, ReferenceAttachment, Source } from "@opencode-ai/core/session-prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { referencePromptMetadata, referenceTextPart } from "./prompt/reference"
import type { PromptInput } from "./prompt-schemas"
import { SessionTools } from "./tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { ConfigMarkdown } from "@/config/markdown"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { Process } from "@/util/process"
import { SystemPrompt } from "./system"
import type { Interface as AgentInterface } from "../agent/agent"

const log = Log.create({ service: "session.prompt" })

const decodeMessageInfo = Schema.decodeUnknownExit(MessageV2.Info)
const decodeMessagePart = Schema.decodeUnknownExit(MessageV2.Part)

export interface CreateUserMessageServices {
  readonly agents: AgentInterface
  readonly bus: any
  readonly provider: any
  readonly events: any
  readonly instruction: any
  readonly sessions: Session.Interface
  readonly references: any
  readonly fsys: any
  readonly mcp: any
  readonly registry: any
  readonly image: any
  readonly plugin: any
  readonly lsp: any
  readonly flags: any
}

export interface CreateUserMessageHelpers {
  readonly currentModel: (sessionID: SessionID) => Effect.Effect<{
    providerID: ProviderID
    modelID: ModelID
    variant?: string
  }>
}

export const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (
  input: PromptInput,
  helpers: CreateUserMessageHelpers,
  services: CreateUserMessageServices,
) {
  const { currentModel } = helpers
  const { agents, bus, provider, events, instruction, sessions, references, fsys, mcp, registry, image, plugin, lsp, flags } = services
  const agentName = input.agent
  const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
  if (!ag) {
    const available = (yield* agents.list()).filter((a: any) => !a.hidden).map((a: any) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
    throw error
  }

  const current = Database.use((db) =>
    db
      .select({ agent: SessionTable.agent, model: SessionTable.model })
      .from(SessionTable)
      .where(eq(SessionTable.id, input.sessionID))
      .get(),
  )
  const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
  const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
  const full =
    !input.variant && ag.variant && same
      ? yield* provider
          .getModel(model.providerID, model.modelID)
          .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
      : undefined
  const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

  const info: MessageV2.User = {
    id: input.messageID ?? MessageID.ascending(),
    role: "user",
    sessionID: input.sessionID,
    time: { created: Date.now() },
    tools: input.tools,
    agent: ag.name,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
      variant,
    },
    system: input.system,
    format: input.format,
  }

  if (current?.agent !== info.agent) {
    yield* events.publish(SessionEvent.AgentSwitched, {
      sessionID: input.sessionID,
      timestamp: DateTime.makeUnsafe(info.time.created),
      agent: info.agent,
    })
  }
  if (
    current?.model?.providerID !== info.model.providerID ||
    current.model.id !== info.model.modelID ||
    (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
  ) {
    yield* events.publish(SessionEvent.ModelSwitched, {
      sessionID: input.sessionID,
      timestamp: DateTime.makeUnsafe(info.time.created),
      model: {
        id: ModelV2.ID.make(info.model.modelID),
        providerID: ProviderV2.ID.make(info.model.providerID),
        variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
      },
    })
  }

  yield* Effect.addFinalizer(() => instruction.clear(info.id))

  type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
  const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
    ...part,
    id: part.id ? PartID.make(part.id) : PartID.ascending(),
  })

  const referenceContextFromFilePart = Effect.fnUntraced(function* (
    part: Extract<PromptInput["parts"][number], { type: "file" }>,
    filepath: string,
  ) {
    const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
    if (!name) return
    const slash = name.indexOf("/")
    if (slash === -1) return

    const reference = yield* references.get(name.slice(0, slash))
    if (!reference || reference.kind === "invalid") return
    if (!AppFileSystem.contains(reference.path, filepath)) return

    const target = path.relative(reference.path, filepath).split(path.sep).join("/")
    if (!target || target.startsWith("../") || target === "..") return

    return referenceTextPart({
      reference,
      source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
      target,
      targetPath: filepath,
    })
  })

  const resolvePart = Effect.fn(
    "SessionPrompt.resolveUserPart",
  )(function* (part) {
    if (part.type === "file") {
      if (part.source?.type === "resource") {
        const { clientName, uri } = part.source
        log.info("mcp resource", { clientName, uri, mime: part.mime })
        const pieces: Draft<MessageV2.Part>[] = [
          {
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text: `Reading MCP resource: ${part.filename} (${uri})`,
          },
        ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value as any
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? (content.contents as any[]) : [content.contents]
          for (const c of items) {
            if ("text" in c && c.text) {
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: c.text,
              })
            } else if ("blob" in c && c.blob) {
              const mime = "mimeType" in c ? c.mimeType : part.mime
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `[Binary content: ${mime}]`,
              })
            }
          }
          pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
        } else {
          const error = Cause.squash(exit.cause)
          log.error("failed to read MCP resource", { error, clientName, uri })
          const message = error instanceof Error ? error.message : String(error)
          pieces.push({
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text: `Failed to read MCP resource ${part.filename}: ${message}`,
          })
        }
        return pieces
      }
      const url = new URL(part.url)
      switch (url.protocol) {
        case "data:":
          if (part.mime === "text/plain") {
            return [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
              },
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: decodeDataUrl(part.url),
              },
              { ...part, messageID: info.id, sessionID: input.sessionID },
            ]
          }
          break
        case "file:": {
          log.info("file", { mime: part.mime })
          const filepath = fileURLToPath(part.url)
          const referenceContext = yield* referenceContextFromFilePart(part, filepath)
          const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

          const { read } = yield* registry.named()
          const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
            const controller = new AbortController()
            return read
              .execute(args, {
                sessionID: input.sessionID,
                abort: controller.signal,
                agent: input.agent!,
                messageID: info.id,
                extra: { bypassCwdCheck: true, ...extra },
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              })
              .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
          }

          if (mime === "text/plain") {
            let offset: number | undefined
            let limit: number | undefined
            const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
            if (range.start != null) {
              const filePathURI = part.url.split("?")[0]
              let start = parseInt(range.start)
              let end = range.end ? parseInt(range.end) : undefined
              if (start === end) {
                const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                for (const symbol of symbols) {
                  let r: LSP.Range | undefined
                  if ("range" in symbol) r = symbol.range
                  else if ("location" in symbol) r = symbol.location.range
                  if (r?.start?.line && r?.start?.line === start) {
                    start = r.start.line
                    end = r?.end?.line ?? start
                    break
                  }
                }
              }
              offset = Math.max(start, 1)
              if (end) limit = end - (offset - 1)
            }
            const args = { filePath: filepath, offset, limit }
            const pieces: Draft<MessageV2.Part>[] = [
              ...(referenceContext
                ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                : []),
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
              },
            ]
            const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
              Effect.flatMap((mdl) => execRead(args, { model: mdl })),
              Effect.exit,
            )
                if (Exit.isSuccess(exit)) {
                  const result: any = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
              })
              if (result.attachments?.length) {
                pieces.push(
                  ...result.attachments.map((a: any) => ({
                    ...a,
                    synthetic: true,
                    filename: a.filename ?? part.filename,
                    messageID: info.id,
                    sessionID: input.sessionID,
                  })),
                )
              } else {
                pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
              }
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read file", { error })
              const message = error instanceof Error ? error.message : String(error)
              yield* bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error: new NamedError.Unknown({ message }).toObject(),
              })
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Read tool failed to read ${filepath} with the following error: ${message}`,
              })
            }
            return pieces
          }

          if (mime === "application/x-directory") {
            const args = { filePath: filepath }
            const exit = yield* execRead(args).pipe(Effect.exit)
            if (Exit.isFailure(exit)) {
              const error = Cause.squash(exit.cause)
              log.error("failed to read directory", { error })
              const message = error instanceof Error ? error.message : String(error)
              yield* bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error: new NamedError.Unknown({ message }).toObject(),
              })
              return [
                ...(referenceContext
                  ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                  : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                },
              ]
            }
            return [
              ...(referenceContext
                ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                : []),
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
              },
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: exit.value.output,
              },
              { ...part, mime, messageID: info.id, sessionID: input.sessionID },
            ]
          }

          return [
            ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
            },
            {
              id: part.id,
              messageID: info.id,
              sessionID: input.sessionID,
              type: "file",
              url:
                `data:${mime};base64,` +
                Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
              mime,
              filename: part.filename!,
              source: part.source,
            },
          ]
        }
      }
    }

    if (part.type === "agent") {
      const perm = Permission.evaluate("task", part.name, ag.permission)
      const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
      return [
        { ...part, messageID: info.id, sessionID: input.sessionID },
        {
          messageID: info.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text:
            " Use the above message and context to generate a prompt and call the task tool with subagent: " +
            part.name +
            hint,
        },
      ]
    }

    return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
  })

  const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
    Effect.map((x: any): any => x.flat().map(assign)),
  )

  yield* plugin.trigger(
    "chat.message",
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: input.model,
      messageID: input.messageID,
      variant: input.variant,
    },
    { message: info, parts: resolvedParts },
  )

  const parts: MessageV2.Part[] = yield* (Effect.forEach(resolvedParts, (part: any) =>
    part.type === "file" && part.mime.startsWith("image/")
      ? image.normalize(part).pipe(
          Effect.catchIf(
            (error: any) => error instanceof Image.ResizerUnavailableError,
            () => Effect.succeed(part),
          ),
        )
      : Effect.succeed(part),
  ) as Effect.Effect<MessageV2.Part[]>)

  const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
  if (Exit.isFailure(parsed)) {
    log.error("invalid user message before save", {
      sessionID: input.sessionID,
      messageID: info.id,
      agent: info.agent,
      model: info.model,
      cause: Cause.pretty(parsed.cause),
    })
  }
  parts.forEach((part, index) => {
    const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
    if (Exit.isSuccess(p)) return
    log.error("invalid user part before save", {
      sessionID: input.sessionID,
      messageID: info.id,
      partID: part.id,
      partType: part.type,
      index,
      cause: Cause.pretty(p.cause),
      part,
    })
  })

  yield* sessions.updateMessage(info)
  for (const part of parts) yield* sessions.updatePart(part)
  const nextPrompt = parts.reduce(
    (result: {
      text: string[]
      files: FileAttachment[]
      agents: AgentAttachment[]
      references: ReferenceAttachment[]
      synthetic: string[]
    }, part) => {
      if (part.type === "text") {
        if (part.synthetic) result.synthetic.push(part.text)
        else result.text.push(part.text)
        const reference = referencePromptMetadata(part.metadata?.reference)
        if (reference) {
          result.references.push(
            new ReferenceAttachment({
              name: reference.name,
              kind: reference.kind,
              uri: reference.path ? pathToFileURL(reference.path).href : undefined,
              repository: reference.repository,
              branch: reference.branch,
              target: reference.target,
              targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
              problem: reference.problem,
              source: new Source({
                start: reference.source.start,
                end: reference.source.end,
                text: reference.source.value,
              }),
            }),
          )
        }
      }
      if (part.type === "file") {
        result.files.push(
          new FileAttachment({
            uri: part.url,
            mime: part.mime,
            name: part.filename,
            source: part.source
              ? new Source({
                  start: part.source.text.start,
                  end: part.source.text.end,
                  text: part.source.text.value,
                })
              : undefined,
          }),
        )
      }
      if (part.type === "agent") {
        result.agents.push(
          new AgentAttachment({
            name: part.name,
            source: part.source
              ? new Source({
                  start: part.source.start,
                  end: part.source.end,
                  text: part.source.value,
                })
              : undefined,
          }),
        )
      }
      return result
    },
    {
      text: [] as string[],
      files: [] as FileAttachment[],
      agents: [] as AgentAttachment[],
      references: [] as ReferenceAttachment[],
      synthetic: [] as string[],
    },
  )
  // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
  if (flags.experimentalEventSystem) {
    yield* events.publish(SessionEvent.Prompted, {
      sessionID: input.sessionID,
      timestamp: DateTime.makeUnsafe(info.time.created),
      prompt: {
        text: nextPrompt.text.join("\n"),
        files: nextPrompt.files,
        agents: nextPrompt.agents,
        references: nextPrompt.references,
      },
    })
  }
  for (const text of nextPrompt.synthetic) {
    // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
    if (flags.experimentalEventSystem) {
      yield* events.publish(SessionEvent.Synthetic, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(info.time.created),
        text,
      })
    }
  }

  return { info, parts }
}, Effect.scoped)
