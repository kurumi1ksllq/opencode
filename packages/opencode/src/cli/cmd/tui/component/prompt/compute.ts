import type { RGBA } from "@opentui/core"
import type { WorkspaceStatus } from "../workspace-label"
import type { PromptInfo } from "./history"
import { money } from "./prompt-context"
import { Locale } from "@/util/locale"
import type { AssistantMessage, UserMessage } from "@opencode-ai/sdk/v2"

export function computeLastUserMessage(messages: any[] | undefined): UserMessage | undefined {
  if (!messages) return undefined
  return messages.findLast((m): m is UserMessage => m.role === "user")
}

export function computeUsage(
  sessionID: string | undefined,
  session: { get: (id: string) => any },
  messages: any[] | undefined,
  providers: any[],
): { context: string; cost: string | undefined } | undefined {
  if (!sessionID) return
  const sess = session.get(sessionID)
  const msg = messages ?? []
  const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
  if (!last) return

  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return

  const model = providers.find((item) => item.id === last.providerID)?.models[last.modelID]
  const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
  const cost = sess?.cost ?? 0
  return {
    context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
    cost: cost > 0 ? money.format(cost) : undefined,
  }
}

export function computeHighlight(leader: boolean, mode: string, theme: { border: RGBA; primary: RGBA }, agent: any, agentService: { color: (name: string) => RGBA }): RGBA {
  if (leader) return theme.border
  if (mode === "shell") return theme.primary
  if (!agent) return theme.border
  return agentService.color(agent.name) ?? theme.border
}

export function computeShowVariant(variants: string[], current: string | undefined) {
  if (variants.length === 0) return false
  return !!current
}

export function computePlaceholderText(
  showPlaceholder: boolean | undefined,
  mode: string,
  shell: string[],
  placeholder: number,
  list: string[],
): string | undefined {
  if (showPlaceholder === false) return undefined
  if (mode === "shell") {
    if (!shell.length) return undefined
    return `Run a command... "${shell[placeholder % shell.length]}"`
  }
  if (!list.length) return undefined
  return `Ask anything... "${list[placeholder % list.length]}"`
}

export function computeWorkspaceLabel(
  workspaceSelection: any,
  sessionID: string | undefined,
  workspaceCreating: boolean,
): { type: "new"; workspaceType: string } | { type: "existing"; workspaceType: string; workspaceName: string; status?: WorkspaceStatus } | undefined {
  const selected = workspaceSelection
  if (!selected) return
  if (selected.type === "none") return
  if (sessionID && !workspaceCreating) return
  if (selected.type === "new") {
    return { type: "new", workspaceType: selected.workspaceType }
  }
  return { type: "existing", workspaceType: selected.workspaceType, workspaceName: selected.workspaceName!, status: "connected" }
}
