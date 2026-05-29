import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"

interface QueueStats {
  queued: number
  processing: number
  completed: number
  failed: number
  total: number
  polling_active: boolean
  repos: string[]
  enabled: boolean
}

export function SymphonyQueue() {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const [stats, setStats] = createSignal<QueueStats | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const fetchStats = () => {
    const baseUrl = sdk.url
    if (!baseUrl) return

    fetch(`${baseUrl}/symphony/queue`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((data: QueueStats) => {
        setStats(data)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }

  createEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <Show when={stats()} fallback={<text />}>
      {(s) => {
        const st = s()
        if (!st.enabled) return <text />

        const width = dimensions().width
        const total = st.queued + st.processing + st.completed + st.failed
        const pct = total > 0 ? Math.round((st.completed / total) * 100) : 0
        const barLen = Math.min(Math.max(Math.floor((width - 55) / 2), 4), 25)

        const c = total > 0 ? Math.round((st.completed / total) * barLen) : 0
        const pr = total > 0 ? Math.round((st.processing / total) * barLen) : 0
        const q = total > 0 ? Math.round((st.queued / total) * barLen) : 0
        const f = Math.max(0, barLen - c - pr - q)

        // Show repo names when space allows, otherwise compact count
        const repoBudget = Math.max(0, width - 58 - barLen)
        const joined = st.repos.join(", ")
        const repoLabel =
          joined.length <= repoBudget
            ? joined
            : `${st.repos.length} repo${st.repos.length !== 1 ? "s" : ""}`

        // Build progress bar segments: skip empty sections
        const barSegments: { count: number; color: any; char: string }[] = []
        if (c > 0) barSegments.push({ count: c, color: theme.success, char: "█" })
        if (pr > 0) barSegments.push({ count: pr, color: theme.primary, char: "▓" })
        if (q > 0) barSegments.push({ count: q, color: theme.warning, char: "▒" })
        if (f > 0 && st.failed > 0) barSegments.push({ count: f, color: theme.error, char: "░" })

        return (
          <box flexDirection="row" gap={1} paddingX={1} paddingY={0} flexShrink={0}>
            {/* Title */}
            <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
              Symphony
            </text>

            {/* Polling indicator */}
            <text fg={st.polling_active ? theme.success : theme.warning}>
              {st.polling_active ? "●" : "○"}
            </text>

            {/* Status counters */}
            <Show when={total > 0}>
              <text>
                <span style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>Q</span>
                <span style={{ fg: theme.warning }}>{st.queued} </span>
                <span style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>P</span>
                <span style={{ fg: theme.primary }}>{st.processing} </span>
                <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>C</span>
                <span style={{ fg: theme.success }}>{st.completed} </span>
                <span style={{ fg: theme.error, attributes: TextAttributes.BOLD }}>F</span>
                <span style={{ fg: theme.error }}>{st.failed}</span>
              </text>

              {/* Progress bar brackets */}
              <text fg={theme.textMuted}>[</text>

              {/* Colored progress bar segments */}
              <For each={barSegments}>
                {(seg) => (
                  <text fg={seg.color}>{seg.char.repeat(seg.count)}</text>
                )}
              </For>

              <text fg={theme.textMuted}>]</text>

              {/* Percentage */}
              <text fg={theme.textMuted}>{pct}%</text>
            </Show>

            {/* Repo names */}
            <Show when={st.repos.length > 0}>
              <text fg={theme.textMuted}>│ {repoLabel}</text>
            </Show>
          </box>
        )
      }}
    </Show>
  )
}
