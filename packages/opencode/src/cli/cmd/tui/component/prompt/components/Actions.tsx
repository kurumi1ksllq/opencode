import type { CommandContext } from "@opentui/keymap"
import type { Renderable, KeyEvent } from "@opentui/core"
import { Flag } from "@opencode-ai/core/flag/flag"
import type { PromptInfo } from "../history"
import type { PromptProps } from "../prompt-context"
import type { AutocompleteRef } from "../autocomplete"
import * as Clipboard from "../../../util/clipboard"
import * as Editor from "@tui/util/editor"
import {
  confirmWorkspaceFileChanges,
  openWorkspaceSelect,
  warpWorkspaceSession,
  type WorkspaceSelection,
} from "../../dialog-workspace-create"
import { DialogSkill } from "../../dialog-skill"
import { DialogStash } from "../../dialog-stash"

export type ActionDeps = {
  input: any
  store: { prompt: PromptInfo; mode: "normal" | "shell"; extmarkToPartIndex: Map<number, number>; interrupt: number }
  setStore: any
  dialog: any
  auto: () => AutocompleteRef | undefined
  status: () => { type: string; message?: string }
  editorContext: () => any
  dismissEditorContext: () => void
  clearPrompt: () => void
  submit: () => Promise<boolean>
  pasteAttachment: (file: { filename?: string; filepath?: string; content: string; mime: string }) => Promise<void>
  pasteInputText: (text: string) => Promise<void>
  props: PromptProps
  sdk: any
  project: any
  sync: any
  toast: any
  warpSession: (selection: WorkspaceSelection) => Promise<void>
  stash: { push: (entry: PromptInfo) => void; pop: () => PromptInfo | undefined; list: () => PromptInfo[] }
  restoreExtmarksFromParts: (parts: PromptInfo["parts"]) => void
  setStoreMode: (mode: "normal" | "shell") => void
  setStoreInterrupt: (value: number | ((prev: number) => number)) => void
  setStorePrompt: (value: PromptInfo | ((prev: PromptInfo) => PromptInfo)) => void
  renderer: any
}

export function buildPromptCommands(deps: ActionDeps) {
  return [
    {
      title: "Clear prompt",
      name: "prompt.clear",
      category: "Prompt",
      hidden: true,
      run: () => {
        deps.clearPrompt()
        deps.dialog.clear()
      },
    },
    {
      title: "Submit prompt",
      name: "prompt.submit",
      category: "Prompt",
      hidden: true,
      run: async () => {
        if (!deps.input.focused) return
        const handled = await deps.submit()
        if (!handled) return
        deps.dialog.clear()
      },
    },
    {
      title: "Remove editor context",
      name: "prompt.editor_context.clear",
      category: "Prompt",
      enabled: Boolean(deps.editorContext()),
      run: () => {
        deps.dismissEditorContext()
        deps.dialog.clear()
      },
    },
    {
      title: "Paste",
      name: "prompt.paste",
      category: "Prompt",
      hidden: true,
      run: async (ctx: CommandContext<Renderable, KeyEvent>) => {
        ctx.event.preventDefault()
        ctx.event.stopPropagation()
        const content = await Clipboard.read()
        if (content?.mime.startsWith("image/")) {
          await deps.pasteAttachment({
            filename: "clipboard",
            mime: content.mime,
            content: content.data,
          })
          return
        }
        if (content?.mime === "text/plain") {
          await deps.pasteInputText(content.data)
        }
      },
    },
    {
      title: "Interrupt session",
      name: "session.interrupt",
      category: "Session",
      hidden: true,
      enabled: deps.status().type !== "idle",
      run: () => {
        if (deps.auto()?.visible) return
        if (!deps.input.focused) return
        if (deps.store.mode === "shell") {
          deps.setStoreMode("normal")
          return
        }
        if (!deps.props.sessionID) return

        deps.setStoreInterrupt((prev: number) => prev + 1)

        setTimeout(() => {
          deps.setStoreInterrupt(0)
        }, 5000)

        if (deps.store.interrupt >= 2) {
          void deps.sdk.client.session.abort({
            sessionID: deps.props.sessionID,
          })
          deps.setStoreInterrupt(0)
        }
        deps.dialog.clear()
      },
    },
    {
      title: "Open editor",
      category: "Session",
      name: "prompt.editor",
      slashName: "editor",
      run: async () => {
        deps.dialog.clear()

        const text = deps.store.prompt.parts
          .filter((p: any) => p.type === "text")
          .reduce((acc: string, p: any) => {
            if (!p.source) return acc
            return acc.replace(p.source.text.value, p.text)
          }, deps.store.prompt.input)

        const nonTextParts = deps.store.prompt.parts.filter((p: any) => p.type !== "text")

        const content = await Editor.open({ value: text, renderer: deps.renderer })
        if (!content) return

        deps.input.setText(content)

        const updatedNonTextParts = nonTextParts
          .map((part: any) => {
            let virtualText = ""
            if (part.type === "file" && part.source?.text) {
              virtualText = part.source.text.value
            } else if (part.type === "agent" && part.source) {
              virtualText = part.source.value
            }

            if (!virtualText) return part

            const newStart = content.indexOf(virtualText)
            if (newStart === -1) return null

            const newEnd = newStart + virtualText.length

            if (part.type === "file" && part.source?.text) {
              return {
                ...part,
                source: {
                  ...part.source,
                  text: {
                    ...part.source.text,
                    start: newStart,
                    end: newEnd,
                  },
                },
              }
            }

            if (part.type === "agent" && part.source) {
              return {
                ...part,
                source: {
                  ...part.source,
                  start: newStart,
                  end: newEnd,
                },
              }
            }

            return part
          })
          .filter((part: any) => part !== null)

        deps.setStorePrompt({
          input: content,
          parts: updatedNonTextParts,
        } as PromptInfo)
        deps.restoreExtmarksFromParts(updatedNonTextParts)
        deps.input.cursorOffset = (Bun as any).stringWidth(content)
      },
    },
    {
      title: "Skills",
      name: "prompt.skills",
      category: "Prompt",
      slashName: "skills",
      run: () => {
        deps.dialog.replace(() => (
          <DialogSkill
            onSelect={(skill: string) => {
              deps.input.setText(`/${skill} `)
              deps.setStorePrompt({
                input: `/${skill} `,
                parts: [],
              } as PromptInfo)
              deps.input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
    {
      title: "Warp",
      desc: "Change the workspace for the session",
      name: "workspace.set",
      category: "Session",
      enabled: Flag.OPENCODE_EXPERIMENTAL_WORKSPACES,
      slashName: "warp",
      run: () => {
        void openWorkspaceSelect({
          dialog: deps.dialog,
          sdk: deps.sdk,
          sync: deps.sync,
          project: deps.project,
          toast: deps.toast,
          onSelect: (selection: WorkspaceSelection) => {
            void deps.warpSession(selection)
          },
        })
      },
    },
  ].map((entry) => ({
    namespace: "palette",
    ...entry,
  }))
}

export function buildStashCommands(deps: ActionDeps) {
  return [
    {
      title: "Stash prompt",
      name: "prompt.stash",
      category: "Prompt",
      enabled: !!deps.store.prompt.input,
      run: () => {
        if (!deps.store.prompt.input) return
        deps.stash.push({
          input: deps.store.prompt.input,
          parts: deps.store.prompt.parts,
        })
        deps.input.extmarks.clear()
        deps.input.clear()
        deps.setStorePrompt({ input: "", parts: [] } as PromptInfo)
        deps.dialog.clear()
      },
    },
    {
      title: "Stash pop",
      name: "prompt.stash.pop",
      category: "Prompt",
      enabled: deps.stash.list().length > 0,
      run: () => {
        const entry = deps.stash.pop()
        if (entry) {
          deps.input.setText(entry.input)
          deps.setStorePrompt({ input: entry.input, parts: entry.parts })
          deps.restoreExtmarksFromParts(entry.parts)
          deps.input.gotoBufferEnd()
        }
        deps.dialog.clear()
      },
    },
    {
      title: "Stash list",
      name: "prompt.stash.list",
      category: "Prompt",
      enabled: deps.stash.list().length > 0,
      run: () => {
        deps.dialog.replace(() => (
          <DialogStash
            onSelect={(entry: PromptInfo) => {
              deps.input.setText(entry.input)
              deps.setStorePrompt({ input: entry.input, parts: entry.parts })
              deps.restoreExtmarksFromParts(entry.parts)
              deps.input.gotoBufferEnd()
            }}
          />
        ))
      },
    },
  ].map((entry) => ({
    namespace: "palette",
    ...entry,
  }))
}
