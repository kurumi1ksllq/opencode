import { createContext, useContext } from "solid-js"
import type { Provider } from "@opencode-ai/sdk/v2"
import { useSync } from "@tui/context/sync"
import { useTuiConfig } from "../../context/tui-config"
import type { ThinkingMode } from "../../context/thinking"

export const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => ThinkingMode
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, Provider>
  sync: ReturnType<typeof useSync>
  tui: ReturnType<typeof useTuiConfig>
}>()

export function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}
