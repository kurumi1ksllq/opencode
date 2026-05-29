import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"

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
      {(s) => (
        <Show when={s().enabled} fallback={<text />}>
          <box flexDirection="row" gap={2} paddingX={1} paddingY={0} flexShrink={0}>
            <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
              Symphony
            </text>
            <text fg={s().polling_active ? theme.success : theme.warning}>
              {s().polling_active ? "●" : "○"} Polling
            </text>
            <text fg={theme.text}>
              <span style={{ fg: theme.textMuted }}>Q</span>
              {s().queued}{" "}
              <span style={{ fg: theme.warning }}>P</span>
              {s().processing}{" "}
              <span style={{ fg: theme.success }}>C</span>
              {s().completed}{" "}
              <span style={{ fg: theme.error }}>F</span>
              {s().failed}
            </text>
            <Show when={s().repos.length > 0}>
              <text fg={theme.textMuted}>
                | {s().repos.length} repo{s().repos.length !== 1 ? "s" : ""}
              </text>
            </Show>
          </box>
        </Show>
      )}
    </Show>
  )
}
