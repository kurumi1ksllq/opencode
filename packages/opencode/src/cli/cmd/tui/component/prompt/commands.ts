import type { PromptInfo } from "./history"

export type CommandDeps = {
  input: any
  setStore: any
  history: { move: (dir: 1 | -1, input: string) => PromptInfo | undefined }
  restoreExtmarksFromParts: (parts: PromptInfo["parts"]) => void
  auto: () => any
  props: { disabled?: boolean }
  store: { mode: "normal" | "shell" }
  cursorVersion: () => number
  shell: () => string[]
  randomIndex: (count: number) => number
  setStoreMode: (mode: "normal" | "shell") => void
  setStorePlaceholder: (value: number) => void
}

export function buildHistoryPreviousCommand(deps: CommandDeps) {
  const { input, history, store, setStore, restoreExtmarksFromParts } = deps
  return {
    name: "prompt.history.previous",
    title: "Previous prompt history",
    category: "Prompt",
    run() {
      if (input.cursorOffset !== 0) {
        if (input.scrollY + input.visualCursor.visualRow === 0) input.cursorOffset = 0
        return false
      }

      const item = history.move(-1, input.plainText)
      if (!item) return false
      input.setText(item.input)
      setStore("prompt", item)
      setStore("mode", item.mode ?? "normal")
      restoreExtmarksFromParts(item.parts)
      input.cursorOffset = 0
    },
  }
}

export function buildHistoryNextCommand(deps: CommandDeps) {
  const { input, history, store, setStore, restoreExtmarksFromParts } = deps
  return {
    name: "prompt.history.next",
    title: "Next prompt history",
    category: "Prompt",
    run() {
      if (input.cursorOffset !== input.plainText.length) {
        if (
          input.scrollY + input.visualCursor.visualRow ===
          Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
        )
          input.cursorOffset = input.plainText.length
        return false
      }

      const item = history.move(1, input.plainText)
      if (!item) return false
      input.setText(item.input)
      setStore("prompt", item)
      setStore("mode", item.mode ?? "normal")
      restoreExtmarksFromParts(item.parts)
      input.cursorOffset = input.plainText.length
    },
  }
}

export function buildShellModeEnterBinding(deps: CommandDeps) {
  return {
    target: () => deps.input,
    enabled: () => {
      deps.cursorVersion()
      return (
        deps.input !== undefined &&
        !deps.props.disabled &&
        deps.store.mode === "normal" &&
        !deps.auto()?.visible &&
        deps.input?.visualCursor.offset === 0
      )
    },
    bindings: [
      {
        key: "!",
        desc: "Shell mode",
        group: "Prompt",
        cmd: () => {
          deps.setStorePlaceholder(deps.randomIndex(deps.shell().length))
          deps.setStoreMode("shell")
        },
      },
    ],
  }
}
