import { MessageID, PartID } from "@/session/schema"
import { iife } from "@/util/iife"
import { assign } from "./part"
import { formatEditorContext } from "./editor-context-format"
import type { PromptInfo } from "./history"
import type { PromptProps } from "./prompt-context"
import {
  openWorkspaceSelect,
  type WorkspaceSelection,
} from "../dialog-workspace-create"
import { DialogWorkspaceUnavailable } from "../dialog-workspace-unavailable"

export type SubmitDeps = {
  input: any
  setStore: any
  store: { prompt: PromptInfo; mode: "normal" | "shell"; extmarkToPartIndex: Map<number, number>; placeholder: number; interrupt: number }
  props: PromptProps
  setWarpNotice: (v: string | undefined) => void
  workspaceCreating: () => boolean
  auto: () => any
  local: any
  sync: any
  exit: () => void
  dialog: any
  project: any
  warpSession: (s: WorkspaceSelection) => Promise<void>
  workspaceSelection: () => WorkspaceSelection | undefined
  sdk: any
  editor: any
  editorContext: () => any
  history: { append: (item: any) => void }
  route: { navigate: (opts: any) => void }
  syncExtmarksWithPromptParts: () => void
  promptPartTypeId: number
  promptModelWarning: () => void
  toast: any
}

const submitting = false

export async function submitFn(deps: SubmitDeps) {
  const { input, store, setStore, props, setWarpNotice, workspaceCreating, auto, local, sync, exit, dialog, project, warpSession, workspaceSelection, sdk, editor, editorContext, history, route, syncExtmarksWithPromptParts, promptPartTypeId, promptModelWarning, toast } = deps

  setWarpNotice(undefined)

  if (input && !input.isDestroyed && input.plainText !== store.prompt.input) {
    setStore("prompt", "input", input.plainText)
    syncExtmarksWithPromptParts()
  }
  if (props.disabled) return false
  if (workspaceCreating()) return false
  if (auto()?.visible) return false
  if (!store.prompt.input) return false
  const agent = local.agent.current()
  if (!agent) return false
  const trimmed = store.prompt.input.trim()
  if (trimmed === "exit" || trimmed === "quit" || trimmed === ":q") {
    void exit()
    return true
  }
  const selectedModel = local.model.current()
  if (!selectedModel) {
    void promptModelWarning()
    return false
  }

  const workspaceSession = props.sessionID ? sync.session.get(props.sessionID) : undefined
  const workspaceID = workspaceSession?.workspaceID
  const workspaceStatus = workspaceID ? (project.workspace.status(workspaceID) ?? "error") : undefined
  if (props.sessionID && workspaceID && workspaceStatus !== "connected") {
    dialog.replace(() => (
      <DialogWorkspaceUnavailable
        onRestore={() => {
          void openWorkspaceSelect({
            dialog,
            sdk,
            sync,
            project,
            toast,
            onSelect: (selection: WorkspaceSelection) => {
              void deps.warpSession(selection)
            },
          })
          return false
        }}
      />
    ))
    return false
  }

  const variant = local.model.variant.current()
  let sessionID = props.sessionID
  if (sessionID == null) {
    const workspace = workspaceSelection()
    const wID = iife(() => {
      if (!workspace) return undefined
      if (workspace.type === "none") return undefined
      if (workspace.type === "existing") return workspace.workspaceID
      return undefined
    })

    const res = await sdk.client.session.create({
      workspace: wID,
      agent: agent.name,
      model: {
        providerID: selectedModel.providerID,
        id: selectedModel.modelID,
        variant,
      },
    })

    if (res.error) {
      console.log("Creating a session failed:", res.error)
      toast.show({
        message: "Creating a session failed. Open console for more details.",
        variant: "error",
      })
      return true
    }

    sessionID = res.data.id
  }

  const messageID = MessageID.ascending()
  let inputText = store.prompt.input

  const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
  const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

  for (const extmark of sortedExtmarks) {
    const partIndex = store.extmarkToPartIndex.get(extmark.id)
    if (partIndex !== undefined) {
      const part = store.prompt.parts[partIndex]
      if (part?.type === "text" && part.text) {
        const before = inputText.slice(0, extmark.start)
        const after = inputText.slice(extmark.end)
        inputText = before + part.text + after
      }
    }
  }

  const nonTextParts = store.prompt.parts.filter((part) => part.type !== "text")

  const currentMode = store.mode
  const editorSelection = editorContext()
  const editorParts =
    editorSelection && editor.labelState() === "pending"
      ? [
          {
            id: PartID.ascending(),
            type: "text" as const,
            text: formatEditorContext(editorSelection),
            synthetic: true,
            metadata: {
              kind: "editor_context",
              source: editorSelection.source ?? "editor",
              filePath: editorSelection.filePath,
              ranges: editorSelection.ranges,
            },
          },
        ]
      : []

  if (store.mode === "shell") {
    void sdk.client.session.shell({
      sessionID,
      agent: agent.name,
      model: {
        providerID: selectedModel.providerID,
        modelID: selectedModel.modelID,
      },
      command: inputText,
    })
    setStore("mode", "normal")
  } else if (
    inputText.startsWith("/") &&
    iife(() => {
      const firstLine = inputText.split("\n")[0]
      const command = firstLine.split(" ")[0].slice(1)
      return sync.data.command.some((x: { name: string }) => x.name === command)
    })
  ) {
    const firstLineEnd = inputText.indexOf("\n")
    const firstLine = firstLineEnd === -1 ? inputText : inputText.slice(0, firstLineEnd)
    const [command, ...firstLineArgs] = firstLine.split(" ")
    const restOfInput = firstLineEnd === -1 ? "" : inputText.slice(firstLineEnd + 1)
    const args = firstLineArgs.join(" ") + (restOfInput ? "\n" + restOfInput : "")

    void sdk.client.session.command({
      sessionID,
      command: command.slice(1),
      arguments: args,
      agent: agent.name,
      model: `${selectedModel.providerID}/${selectedModel.modelID}`,
      messageID,
      variant,
      parts: nonTextParts
        .filter((x) => x.type === "file")
        .map((x) => ({
          id: PartID.ascending(),
          ...x,
        })),
    })
  } else {
    sdk.client.session
      .prompt({
        sessionID,
        ...selectedModel,
        messageID,
        agent: agent.name,
        model: selectedModel,
        variant,
        parts: [
          ...editorParts,
          {
            id: PartID.ascending(),
            type: "text",
            text: inputText,
          },
          ...nonTextParts.map(assign),
        ],
      })
      .catch(() => {})
    if (editorParts.length > 0) editor.markSelectionSent()
  }
  history.append({
    ...store.prompt,
    mode: currentMode,
  })
  input.extmarks.clear()
  setStore("prompt", {
    input: "",
    parts: [],
  })
  setStore("extmarkToPartIndex", new Map())
  props.onSubmit?.()

  if (!props.sessionID) {
    if (editorParts.length > 0) editor.preserveSelectionFromNewSession()
    setTimeout(() => {
      route.navigate({
        type: "session",
        sessionID,
      })
    }, 50)
  }
  input.clear()
  return true
}
