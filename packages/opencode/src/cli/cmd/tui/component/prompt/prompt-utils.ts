import type { TextareaRenderable } from "@opentui/core"
import type { FilePart } from "@opencode-ai/sdk/v2"
import { fileURLToPath } from "url"
import path from "path"
import { produce } from "solid-js/store"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { DRAFT_RETENTION_MIN_CHARS } from "./prompt-context"
import type { PromptInfo } from "./history"

export type PromptUtilsDeps = {
  input: TextareaRenderable
  setStore: any
  fileStyleId: number
  agentStyleId: number
  pasteStyleId: number
  promptPartTypeId: number
  kv: { get: (key: string, fallback?: boolean) => boolean }
  sync: { data: { config: { experimental?: { disable_paste_summary?: boolean } } } }
  renderer: { requestRender: () => void }
  history: { append: (item: PromptInfo & { mode?: string }) => void }
  store: { prompt: PromptInfo; mode: "normal" | "shell" }
}

export function restoreExtmarksFromParts(deps: PromptUtilsDeps, parts: PromptInfo["parts"]) {
  const { input, setStore, fileStyleId, agentStyleId, pasteStyleId, promptPartTypeId } = deps
  input.extmarks.clear()
  setStore("extmarkToPartIndex", new Map())

  parts.forEach((part, partIndex) => {
    let start = 0
    let end = 0
    let virtualText = ""
    let styleId: number | undefined

    if (part.type === "file" && part.source?.text) {
      start = part.source.text.start
      end = part.source.text.end
      virtualText = part.source.text.value
      styleId = fileStyleId
    } else if (part.type === "agent" && part.source) {
      start = part.source.start
      end = part.source.end
      virtualText = part.source.value
      styleId = agentStyleId
    } else if (part.type === "text" && part.source?.text) {
      start = part.source.text.start
      end = part.source.text.end
      virtualText = part.source.text.value
      styleId = pasteStyleId
    }

    if (virtualText) {
      const extmarkId = input.extmarks.create({
        start,
        end,
        virtual: true,
        styleId,
        typeId: promptPartTypeId,
      })
      setStore("extmarkToPartIndex", (map: Map<number, number>) => {
        const newMap = new Map(map)
        newMap.set(extmarkId, partIndex)
        return newMap
      })
    }
  })
}

export function syncExtmarksWithPromptParts(deps: PromptUtilsDeps) {
  const { input, setStore, promptPartTypeId } = deps
  const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
  setStore(
    produce((draft: any) => {
      const newMap = new Map<number, number>()
      const newParts: typeof draft.prompt.parts = []

      for (const extmark of allExtmarks) {
        const partIndex = draft.extmarkToPartIndex.get(extmark.id)
        if (partIndex !== undefined) {
          const part = draft.prompt.parts[partIndex]
          if (part) {
            if (part.type === "agent" && part.source) {
              part.source.start = extmark.start
              part.source.end = extmark.end
            } else if (part.type === "file" && part.source?.text) {
              part.source.text.start = extmark.start
              part.source.text.end = extmark.end
            } else if (part.type === "text" && part.source?.text) {
              part.source.text.start = extmark.start
              part.source.text.end = extmark.end
            }
            newMap.set(extmark.id, newParts.length)
            newParts.push(part)
          }
        }
      }

      draft.extmarkToPartIndex = newMap
      draft.prompt.parts = newParts
    }),
  )
}

export function pasteText(deps: PromptUtilsDeps, text: string, virtualText: string) {
  const { input, setStore, pasteStyleId, promptPartTypeId } = deps
  const currentOffset = input.visualCursor.offset
  const extmarkStart = currentOffset
  const extmarkEnd = extmarkStart + virtualText.length

  input.insertText(virtualText + " ")

  const extmarkId = input.extmarks.create({
    start: extmarkStart,
    end: extmarkEnd,
    virtual: true,
    styleId: pasteStyleId,
    typeId: promptPartTypeId,
  })

  setStore(
    produce((draft: any) => {
      const partIndex = draft.prompt.parts.length
      draft.prompt.parts.push({
        type: "text" as const,
        text,
        source: {
          text: {
            start: extmarkStart,
            end: extmarkEnd,
            value: virtualText,
          },
        },
      })
      draft.extmarkToPartIndex.set(extmarkId, partIndex)
    }),
  )
}

export async function pasteInputText(deps: PromptUtilsDeps, text: string) {
  const { input, setStore, kv, sync, renderer } = deps
  const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const pastedContent = normalizedText.trim()
  const filepath = iife(() => {
    const raw = pastedContent.replace(/^['"]+|['"]+$/g, "")
    if (raw.startsWith("file://")) {
      try {
        return fileURLToPath(raw)
      } catch {}
    }
    if (process.platform === "win32") return raw
    return raw.replace(/\\(.)/g, "$1")
  })
  const isUrl = /^(https?):\/\//.test(filepath)
  if (!isUrl) {
    try {
      const mime = await Filesystem.mimeType(filepath)
      const filename = path.basename(filepath)
      if (mime === "image/svg+xml") {
        const content = await Filesystem.readText(filepath).catch(() => {})
        if (content) {
          pasteText(deps, content, `[SVG: ${filename ?? "image"}]`)
          return
        }
      }
      if (mime.startsWith("image/") || mime === "application/pdf") {
        const content = await Filesystem.readArrayBuffer(filepath)
          .then((buffer) => Buffer.from(buffer).toString("base64"))
          .catch(() => {})
        if (content) {
          await pasteAttachment(deps, {
            filename,
            filepath,
            mime,
            content,
          })
          return
        }
      }
    } catch {}
  }

  const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
  if (
    (lineCount >= 3 || pastedContent.length > 150) &&
    kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary)
  ) {
    pasteText(deps, pastedContent, `[Pasted ~${lineCount} lines]`)
    return
  }

  input.insertText(normalizedText)

  setTimeout(() => {
    if (!input || input.isDestroyed) return
    input.getLayoutNode().markDirty()
    renderer.requestRender()
  }, 0)
}

export async function pasteAttachment(
  deps: PromptUtilsDeps,
  file: { filename?: string; filepath?: string; content: string; mime: string },
) {
  const { input, setStore, pasteStyleId, promptPartTypeId, store } = deps
  const currentOffset = input.visualCursor.offset
  const extmarkStart = currentOffset
  const pdf = file.mime === "application/pdf"
  const count = store.prompt.parts.filter((x) => {
    if (x.type !== "file") return false
    if (pdf) return x.mime === "application/pdf"
    return x.mime.startsWith("image/")
  }).length
  const virtualText = pdf ? `[PDF ${count + 1}]` : `[Image ${count + 1}]`
  const extmarkEnd = extmarkStart + virtualText.length
  const textToInsert = virtualText + " "

  input.insertText(textToInsert)

  const extmarkId = input.extmarks.create({
    start: extmarkStart,
    end: extmarkEnd,
    virtual: true,
    styleId: pasteStyleId,
    typeId: promptPartTypeId,
  })

  const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
    type: "file" as const,
    mime: file.mime,
    filename: file.filename,
    url: `data:${file.mime};base64,${file.content}`,
    source: {
      type: "file",
      path: file.filepath ?? file.filename ?? "",
      text: {
        start: extmarkStart,
        end: extmarkEnd,
        value: virtualText,
      },
    },
  }
  setStore(
    produce((draft: any) => {
      const partIndex = draft.prompt.parts.length
      draft.prompt.parts.push(part)
      draft.extmarkToPartIndex.set(extmarkId, partIndex)
    }),
  )
  return
}

export function promptModelWarning(deps: { toast: { show: (opts: { variant: string; message: string; duration?: number }) => void }; dialog: { replace: (el: any) => void }; sync: { data: { provider: any[] } } }) {
  deps.toast.show({
    variant: "warning",
    message: "Connect a provider to send prompts",
    duration: 3000,
  })
  if (deps.sync.data.provider.length === 0) {
    // DialogProviderConnect is rendered by the caller
  }
}

export function clearPrompt(deps: PromptUtilsDeps) {
  const { input, setStore, history, store } = deps
  if (store.prompt.input.trim().length >= DRAFT_RETENTION_MIN_CHARS || store.prompt.parts.length > 0) {
    history.append({
      ...store.prompt,
      mode: store.mode,
    })
  }
  input.clear()
  input.extmarks.clear()
  setStore("prompt", {
    input: "",
    parts: [],
  })
  setStore("extmarkToPartIndex", new Map())
}
