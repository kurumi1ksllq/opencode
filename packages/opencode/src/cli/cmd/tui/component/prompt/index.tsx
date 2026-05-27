import {
  BoxRenderable,
  TextareaRenderable,
  MouseEvent,
  PasteEvent,
  decodePasteBytes,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"

import { createEffect, createMemo, onMount, createSignal, onCleanup, on } from "solid-js"
import "opentui-spinner/solid"
import path from "path"
import { useLocal } from "@tui/context/local"
import { tint, useTheme } from "@tui/context/theme"

import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { useEvent } from "@tui/context/event"
import { editorSelectionKey, useEditorContext } from "@tui/context/editor"
import { MessageID, PartID } from "@/session/schema"
import { createStore, produce, unwrap } from "solid-js/store"
import { usePromptHistory, type PromptInfo } from "./history"
import { computePromptTraits } from "./traits"
import { assign, expandPastedTextPlaceholders } from "./part"
import { usePromptStash } from "./stash"
import { type AutocompleteRef } from "./autocomplete"
import { useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useExit } from "../../context/exit"

import { TuiEvent } from "../../event"
import { iife } from "@/util/iife"
import { Locale } from "@/util/locale"
import { createColors, createFrames } from "../../ui/spinner.ts"
import { useDialog } from "@tui/ui/dialog"
import { DialogProvider as DialogProviderConnect } from "../dialog-provider"
import { useToast } from "../../ui/toast"
import { useKV } from "../../context/kv"
import { createFadeIn } from "../../util/signal"
import { type WorkspaceSelection } from "../dialog-workspace-create"
import { useArgs } from "@tui/context/args"

import { OPENCODE_BASE_MODE, useBindings, useCommandShortcut, useLeaderActive, useOpencodeKeymap } from "../../keymap"
import { useTuiConfig } from "../../context/tui-config"
import {
  DRAFT_RETENTION_MIN_CHARS,
  fadeColor,
  randomIndex,
  type PromptProps,
  type PromptRef,
} from "./prompt-context"
import { PromptInput } from "./components/PromptInput"
import { Suggestions } from "./components/Suggestions"
import { Sidebar } from "./components/Sidebar"
import { OutputPanel } from "./components/OutputPanel"
import { buildPromptCommands, buildStashCommands, type ActionDeps } from "./components/Actions"
import * as PromptUtils from "./prompt-utils"
import * as Workspace from "./workspace"
import { computeHighlight, computeShowVariant, computePlaceholderText, computeWorkspaceLabel, computeUsage, computeLastUserMessage } from "./compute"
import * as Submit from "./submit"
import * as Commands from "./commands"
export type { PromptProps, PromptRef }
import { hasEditorRangeSelection, getEditorRangeLabel, formatEditorContext } from "./editor-context-format"
export { hasEditorRangeSelection, getEditorRangeLabel, formatEditorContext }

let stashed: { prompt: PromptInfo; cursor: number } | undefined

export function Prompt(props: PromptProps) {
  let input: TextareaRenderable
  let anchor: BoxRenderable
  const [inputTarget, setInputTarget] = createSignal<TextareaRenderable | undefined>()

  const leader = useLeaderActive()
  const local = useLocal()
  const args = useArgs()
  const sdk = useSDK()
  const editor = useEditorContext()
  const route = useRoute()
  const project = useProject()
  const sync = useSync()
  const tuiConfig = useTuiConfig()
  const dialog = useDialog()
  const toast = useToast()
  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const history = usePromptHistory()
  const stash = usePromptStash()
  const keymap = useOpencodeKeymap()
  const agentShortcut = useCommandShortcut("agent.cycle")
  const paletteShortcut = useCommandShortcut("command.palette.show")
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const kv = useKV()
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  const list = createMemo(() => props.placeholders?.normal ?? [])
  const shell = createMemo(() => props.placeholders?.shell ?? [])
  const fileContextEnabled = createMemo(() => kv.get("file_context_enabled", true))
  const [dismissedEditorSelectionKey, setDismissedEditorSelectionKey] = createSignal<string>()
  const editorContext = createMemo(() => {
    const selection = fileContextEnabled() ? editor.selection() : undefined
    if (!selection) return
    return editorSelectionKey(selection) === dismissedEditorSelectionKey() ? undefined : selection
  })
  const editorPath = createMemo(() => editorContext()?.filePath)
  const editorSelectionLabel = createMemo(() => {
    const ranges = editorContext()?.ranges
    if (!ranges) return
    const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
    if (!first) return
    return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined]
      .filter(Boolean)
      .join(" ")
  })
  const editorFileLabel = createMemo(() => {
    const value = editorPath()
    if (!value) return
    const filename = path.basename(value)
    const file = /^index\.[^./]+$/.test(filename)
      ? [path.basename(path.dirname(value)), filename].filter(Boolean).join("/")
      : filename
    return `${file.split(path.sep).join("/")}${editorSelectionLabel() ?? ""}`
  })
  const editorFileLabelDisplay = createMemo(() => {
    const file = editorFileLabel()
    if (!file) return
    return Locale.truncateMiddle(file, Math.max(12, Math.min(48, Math.floor(dimensions().width / 3))))
  })
  const editorContextLabelState = createMemo(() => editor.labelState())
  const [auto, setAuto] = createSignal<AutocompleteRef>()
  const [workspaceSelection, setWorkspaceSelection] = createSignal<WorkspaceSelection>()
  const [workspaceCreating, setWorkspaceCreating] = createSignal(false)
  const [workspaceCreatingDots, setWorkspaceCreatingDots] = createSignal(3)
  const [warpNotice, setWarpNotice] = createSignal<string>()
  const [cursorVersion, setCursorVersion] = createSignal(0)
  const currentProviderLabel = createMemo(() => local.model.parsed().provider)
  const hasRightContent = createMemo(() => Boolean(props.right))

  function selectWorkspace(selection: WorkspaceSelection | undefined) {
    setWorkspaceSelection(selection)
  }

  function setCreatingWorkspace(creating: boolean) {
    setWorkspaceCreating(creating)
  }

  function showWarpNotice(n: string) { Workspace.showWarpNotice({setWarpNotice} as any,n) }
  async function createWorkspace(s: Extract<WorkspaceSelection,{type:"new"}>) { return Workspace.createWorkspace({setWorkspaceSelection,setWorkspaceCreating,sdk,project,toast} as any,s) }
  async function warpSession(s: WorkspaceSelection) { await Workspace.warpSession({setWorkspaceSelection,setWarpNotice,setCreatingWorkspace,sdk,project,toast,dialog,sync,sessionID:props.sessionID} as any,s) }

  createEffect(() => {
    if (!workspaceCreating()) {
      setWorkspaceCreatingDots(3)
      return
    }
    const timer = setInterval(() => setWorkspaceCreatingDots((dots) => (dots % 3) + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })

  function promptModelWarning() { PromptUtils.promptModelWarning({toast,dialog,sync} as any); if (sync.data.provider.length === 0) dialog.replace(() => <DialogProviderConnect />) }
  function dismissEditorContext() { setDismissedEditorSelectionKey(editorSelectionKey(editorContext())); editor.clearSelection() }
  const fileStyleId = syntax().getStyleId("extmark.file")!
  const agentStyleId = syntax().getStyleId("extmark.agent")!
  const pasteStyleId = syntax().getStyleId("extmark.paste")!
  let promptPartTypeId = 0
  const event = useEvent()

  event.on(TuiEvent.PromptAppend.type, (evt) => {
    if (!input || input.isDestroyed) return
    input.insertText(evt.properties.text)
    setTimeout(() => {
      // setTimeout is a workaround and needs to be addressed properly
      if (!input || input.isDestroyed) return
      input.getLayoutNode().markDirty()
      input.gotoBufferEnd()
      renderer.requestRender()
    }, 0)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.disabled) input.cursorColor = theme.backgroundElement
    if (!props.disabled) input.cursorColor = theme.text
  })

  const lastUserMessage = createMemo(() => computeLastUserMessage(props.sessionID ? sync.data.message[props.sessionID] : undefined))

  const usage = createMemo(() => computeUsage(props.sessionID, sync.session, props.sessionID ? sync.data.message[props.sessionID] : undefined, sync.data.provider))

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: randomIndex(list().length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  createEffect(
    on(
      () => props.sessionID,
      () => {
        setStore("placeholder", randomIndex(list().length))
      },
      { defer: true },
    ),
  )

  // Initialize agent/model/variant from last user message when session changes
  let syncedSessionID: string | undefined
  createEffect(() => {
    const sessionID = props.sessionID
    const msg = lastUserMessage()

    if (sessionID !== syncedSessionID) {
      if (!sessionID || !msg) return

      syncedSessionID = sessionID

      // Only set agent if it's a primary agent (not a subagent)
      const isPrimaryAgent = local.agent.list().some((x) => x.name === msg.agent)
      if (msg.agent && isPrimaryAgent) {
        // Keep command line --agent if specified.
        if (!args.agent) local.agent.set(msg.agent)
        if (msg.model) {
          local.model.set(msg.model)
          local.model.variant.set(msg.model.variant)
        }
      }
    }
  })

  const actionDeps = (): ActionDeps => ({
    input,
    store,
    setStore,
    dialog,
    auto,
    status,
    editorContext,
    dismissEditorContext,
    clearPrompt,
    submit,
    pasteAttachment,
    pasteInputText,
    props,
    sdk,
    project,
    sync,
    toast,
    warpSession,
    stash,
    restoreExtmarksFromParts,
    setStoreMode: (mode) => setStore("mode", mode),
    setStoreInterrupt: (value) => setStore("interrupt", value as any),
    setStorePrompt: (value) => setStore("prompt", value as any),
    renderer,
  })

  const promptCommands = createMemo(() => buildPromptCommands(actionDeps()))

  useBindings(() => ({
    commands: promptCommands(),
  }))

  useBindings(() => ({
    mode: OPENCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("prompt.palette", [
      "prompt.submit",
      "prompt.editor",
      "prompt.editor_context.clear",
      "prompt.stash",
      "prompt.stash.pop",
      "prompt.stash.list",
      "session.interrupt",
      "workspace.set",
    ]),
  }))

  const ref: PromptRef = {
    get focused() {
      return input.focused
    },
    get current() {
      return store.prompt
    },
    focus() {
      input.focus()
    },
    blur() {
      input.blur()
    },
    set(prompt) {
      input.setText(prompt.input)
      setStore("prompt", prompt)
      restoreExtmarksFromParts(prompt.parts)
      input.gotoBufferEnd()
    },
    reset() {
      input.clear()
      input.extmarks.clear()
      setStore("prompt", {
        input: "",
        parts: [],
      })
      setStore("extmarkToPartIndex", new Map())
    },
    submit() {
      void submit()
    },
  }

  onMount(() => {
    const saved = stashed
    stashed = undefined
    if (store.prompt.input) return
    if (saved && saved.prompt.input) {
      input.setText(saved.prompt.input)
      setStore("prompt", saved.prompt)
      restoreExtmarksFromParts(saved.prompt.parts)
      input.cursorOffset = saved.cursor
    }
  })

  onCleanup(() => {
    if (store.prompt.input) {
      stashed = { prompt: unwrap(store.prompt), cursor: input.cursorOffset }
    }
    setInputTarget(undefined)
    props.ref?.(undefined)
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (props.visible === false || dialog.stack.length > 0) {
      if (input.focused) input.blur()
      return
    }

    // Slot/plugin updates can remount the background prompt while a dialog is open.
    // Keep focus with the dialog and let the prompt reclaim it after the dialog closes.
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    if (!input || input.isDestroyed) return
    input.traits = {
      ...input.traits,
      ...computePromptTraits({
        mode: store.mode,
        autocompleteVisible: !!auto()?.visible,
      }),
    }
  })

  function restoreExtmarksFromParts(p: PromptInfo["parts"]) { PromptUtils.restoreExtmarksFromParts({input,setStore,fileStyleId,agentStyleId,pasteStyleId,promptPartTypeId} as any,p) }
  function syncExtmarksWithPromptParts() { PromptUtils.syncExtmarksWithPromptParts({input,setStore,promptPartTypeId} as any) }

  const stashCommands = createMemo(() => buildStashCommands(actionDeps()))

  useBindings(() => ({
    commands: stashCommands(),
  }))

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled,
      bindings: tuiConfig.keybinds.get("prompt.paste"),
    }
  })

  useBindings(() => {
    return {
      target: inputTarget,
      enabled: inputTarget() !== undefined && !props.disabled && store.prompt.input !== "",
      bindings: tuiConfig.keybinds.get("prompt.clear"),
    }
  })

  useBindings(() => Commands.buildShellModeEnterBinding(cmdDeps()))
  useBindings(() => ({ target: inputTarget, enabled: inputTarget() !== undefined && store.mode === "shell", bindings: [{ key: "escape", desc: "Exit shell mode", group: "Prompt", cmd: () => setStore("mode", "normal") }] }))
  useBindings(() => ({
    target: inputTarget,
    enabled: (() => { cursorVersion(); return inputTarget() !== undefined && store.mode === "shell" && input?.visualCursor.offset === 0 })(),
    bindings: [{ key: "backspace", desc: "Exit shell mode", group: "Prompt", cmd: () => setStore("mode", "normal") }],
  }))

  const cmdDeps = (): Commands.CommandDeps => ({input,setStore,history,restoreExtmarksFromParts,auto,props,store,cursorVersion,shell,randomIndex,setStoreMode:(m)=>setStore("mode",m),setStorePlaceholder:(v)=>setStore("placeholder",v)})

  useBindings(() => ({
    target: inputTarget,
    enabled: (() => { cursorVersion(); return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined })(),
    commands: [Commands.buildHistoryPreviousCommand(cmdDeps())],
    bindings: tuiConfig.keybinds.get("prompt.history.previous"),
  }))

  useBindings(() => ({
    target: inputTarget,
    enabled: (() => { cursorVersion(); return inputTarget() !== undefined && !props.disabled && !auto()?.visible && input !== undefined })(),
    commands: [Commands.buildHistoryNextCommand(cmdDeps())],
    bindings: tuiConfig.keybinds.get("prompt.history.next"),
  }))

  let submitting = false
  async function submit() {
    if (submitting) return false
    submitting = true
    try {
      return await Submit.submitFn({
        input, setStore, store, props, setWarpNotice,
        workspaceCreating, auto, local, sync, exit, dialog, project,
        warpSession, workspaceSelection, sdk, editor, editorContext,
        history, route, syncExtmarksWithPromptParts, promptPartTypeId,
        promptModelWarning, toast,
      })
    } finally {
      submitting = false
    }
  }
  const exit = useExit()

  function pasteText(t:string,v:string) { PromptUtils.pasteText({input,setStore,pasteStyleId,promptPartTypeId} as any,t,v) }
  async function pasteInputText(t:string) { await PromptUtils.pasteInputText({input,setStore,kv,sync,renderer} as any,t) }
  async function pasteAttachment(f:{filename?:string;filepath?:string;content:string;mime:string}) { await PromptUtils.pasteAttachment({input,setStore,pasteStyleId,promptPartTypeId,store} as any,f) }
  function clearPrompt() { PromptUtils.clearPrompt({input,setStore,history,store} as any) }

  const highlight = createMemo(() => computeHighlight(leader(), store.mode, theme, local.agent.current(), local.agent))
  const showVariant = createMemo(() => computeShowVariant(local.model.variant.list(), local.model.variant.current()))

  const agentMetaAlpha = createFadeIn(() => !!local.agent.current(), animationsEnabled)
  const modelMetaAlpha = createFadeIn(() => !!local.agent.current() && store.mode === "normal", animationsEnabled)
  const variantMetaAlpha = createFadeIn(
    () => !!local.agent.current() && store.mode === "normal" && showVariant(),
    animationsEnabled,
  )
  const borderHighlight = createMemo(() => tint(theme.border, highlight(), agentMetaAlpha()))

  const placeholderText = createMemo(() => computePlaceholderText(props.showPlaceholder, store.mode, shell(), store.placeholder, list()))
  const workspaceLabel = createMemo(() => computeWorkspaceLabel(workspaceSelection(), props.sessionID, workspaceCreating()))

  const spinnerDef = createMemo(() => {
    const agent =
      status().type !== "idle"
        ? (local.agent.list().find((a) => a.name === lastUserMessage()?.agent) ?? local.agent.current())
        : local.agent.current()
    const color = agent ? local.agent.color(agent.name) : theme.border
    return {
      frames: createFrames({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
      color: createColors({
        color,
        style: "blocks",
        inactiveFactor: 0.6,
        // enableFading: false,
        minAlpha: 0.3,
      }),
    }
  })

  return (
    <>
      <box ref={(r: BoxRenderable) => (anchor = r)} visible={props.visible !== false}>
        <PromptInput
          disabled={props.disabled}
          mode={store.mode}
          placeholderText={placeholderText()}
          borderHighlight={borderHighlight()}
          highlight={highlight()}
          agentMetaAlpha={agentMetaAlpha()}
          modelMetaAlpha={modelMetaAlpha()}
          variantMetaAlpha={variantMetaAlpha()}
          showVariant={showVariant()}
          hasRightContent={hasRightContent()}
          right={props.right}
          currentProviderLabel={currentProviderLabel()}
          onContentChange={() => {
            const value = input.plainText
            setStore("prompt", "input", value)
            auto()?.onInput(value)
            syncExtmarksWithPromptParts()
            setCursorVersion((value) => value + 1)
          }}
          onCursorChange={() => setCursorVersion((value) => value + 1)}
          onKeyDown={(e: { preventDefault(): void }) => {
            if (props.disabled) {
              e.preventDefault()
              return
            }
          }}
          onSubmit={() => {
            setTimeout(() => setTimeout(() => submit(), 0), 0)
          }}
          onPaste={async (event: PasteEvent) => {
            if (props.disabled) {
              event.preventDefault()
              return
            }

            const normalizedText = decodePasteBytes(event.bytes).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
            const pastedContent = normalizedText.trim()

            if (!pastedContent) {
              keymap.dispatchCommand("prompt.paste")
              return
            }

            event.preventDefault()

            await pasteInputText(normalizedText)
          }}
          textareaRef={(r: TextareaRenderable) => {
            input = r
            Object.assign(r, {
              getClipboardText: (text: string) => expandPastedTextPlaceholders(text, store.prompt.parts),
            })
            setInputTarget(r)
            if (promptPartTypeId === 0) {
              promptPartTypeId = input.extmarks.registerType("prompt-part")
            }
            props.ref?.(ref)
            setTimeout(() => {
              if (!input || input.isDestroyed) return
              input.cursorColor = theme.text
            }, 0)
          }}
          cursorColor={props.disabled ? theme.backgroundElement : theme.text}
          promptRef={props.ref}
        />
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <Sidebar
            status={status}
            interrupt={store.interrupt}
            warpNotice={warpNotice}
            workspaceLabel={workspaceLabel}
            workspaceCreating={workspaceCreating()}
            workspaceCreatingDots={workspaceCreatingDots()}
            spinnerColor={spinnerDef()}
            hint={props.hint}
          />
          <OutputPanel
            status={status}
            mode={store.mode}
            editorContextLabelState={editorContextLabelState}
            editorFileLabelDisplay={editorFileLabelDisplay}
            usage={usage}
            agentShortcut={agentShortcut}
            paletteShortcut={paletteShortcut}
          />
        </box>
      </box>
      <Suggestions
        sessionID={props.sessionID}
        setAuto={(r) => setAuto(() => r)}
        anchor={() => anchor}
        input={() => input}
        setStorePrompt={(cb) => {
          setStore("prompt", produce(cb))
        }}
        setStoreExtmark={(partIndex, extmarkId) => {
          setStore("extmarkToPartIndex", (map: Map<number, number>) => {
            const newMap = new Map(map)
            newMap.set(extmarkId, partIndex)
            return newMap
          })
        }}
        value={store.prompt.input}
        fileStyleId={fileStyleId}
        agentStyleId={agentStyleId}
        promptPartTypeId={() => promptPartTypeId}
      />
    </>
  )
}
