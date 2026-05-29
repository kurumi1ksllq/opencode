import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes, RGBA } from "@opentui/core"
import { useDialog } from "@tui/ui/dialog"
import { useBindings } from "../keymap"

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

function StatCard(props: { label: string; value: number; color: RGBA }) {
  const { theme } = useTheme()

  return (
    <box
      flexDirection="column"
      alignItems="center"
      paddingX={2}
      paddingY={1}
      gap={0}
      backgroundColor={theme.backgroundElement}
      flexGrow={0}
      flexShrink={0}
    >
      <text fg={props.color} attributes={TextAttributes.BOLD}>
        {props.value}
      </text>
      <text fg={theme.textMuted}>{props.label}</text>
    </box>
  )
}

function BreakdownRow(props: { label: string; value: number; total: number; color: RGBA }) {
  const { theme } = useTheme()
  const pct = props.total > 0 ? Math.round((props.value / props.total) * 100) : 0
  const barWidth = 20
  const filled = props.total > 0 ? Math.round((props.value / props.total) * barWidth) : 0
  const empty = barWidth - filled

  return (
    <box flexDirection="row" gap={1} paddingY={0}>
      <text attributes={TextAttributes.BOLD} fg={props.color} flexShrink={0} width={12}>
        {props.label}
      </text>
      <text fg={theme.textMuted}>:</text>
      <text attributes={TextAttributes.BOLD} fg={props.color} flexShrink={0} width={4}>
        {props.value}
      </text>
      <text fg={theme.textMuted} flexShrink={0} width={8}>
        ({pct}%)
      </text>
      <text>
        <span style={{ fg: props.color }}>{"█".repeat(filled)}</span>
        <span style={{ fg: theme.textMuted }}>{"░".repeat(empty)}</span>
      </text>
    </box>
  )
}

export function DialogSymphony() {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const [stats, setStats] = createSignal<QueueStats | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Close symphony view",
        group: "Dialog",
        cmd: () => dialog.clear(),
      },
    ],
  }))

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

  onMount(() => {
    dialog.setSize("large")
    fetchStats()
  })

  createEffect(() => {
    const interval = setInterval(fetchStats, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={2}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Symphony Queue Dashboard
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={error()}>
        {(err) => (
          <box paddingY={1} backgroundColor={theme.backgroundElement}>
            <text fg={theme.error}>Failed to load: {err()}</text>
          </box>
        )}
      </Show>

      <Show when={stats()}>
        {(s) => {
          const st = s()
          const total = st.queued + st.processing + st.completed + st.failed
          const pct = total > 0 ? Math.round((st.completed / total) * 100) : 0

          return (
            <>
              {/* ===== Stats Cards Row ===== */}
              <box flexDirection="row" gap={2} paddingY={1} justifyContent="center">
                <StatCard label="Total" value={total} color={theme.text} />
                <StatCard label="Queued" value={st.queued} color={theme.warning} />
                <StatCard label="Processing" value={st.processing} color={theme.primary} />
                <StatCard label="Completed" value={st.completed} color={theme.success} />
                <StatCard label="Failed" value={st.failed} color={theme.error} />
              </box>

              {/* ===== Large Progress Bar ===== */}
              <Show when={total > 0}>
                <box flexDirection="column" gap={1} paddingY={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Overall Progress
                  </text>
                  <box flexDirection="row" gap={1} alignItems="center">
                    {/* Full-width proportional bar using colored boxes */}
                    <box flexDirection="row" flexGrow={1} minHeight={1}>
                      <Show when={st.completed > 0}>
                        <box
                          flexGrow={st.completed}
                          backgroundColor={theme.success}
                          minWidth={1}
                        />
                      </Show>
                      <Show when={st.processing > 0}>
                        <box
                          flexGrow={st.processing}
                          backgroundColor={theme.primary}
                          minWidth={1}
                        />
                      </Show>
                      <Show when={st.queued > 0}>
                        <box
                          flexGrow={st.queued}
                          backgroundColor={theme.warning}
                          minWidth={1}
                        />
                      </Show>
                      <Show when={st.failed > 0}>
                        <box
                          flexGrow={st.failed}
                          backgroundColor={theme.error}
                          minWidth={1}
                        />
                      </Show>
                    </box>
                    <text attributes={TextAttributes.BOLD} fg={theme.text}>
                      {pct}%
                    </text>
                  </box>
                  {/* Progress bar legend */}
                  <box flexDirection="row" gap={2}>
                    <text>
                      <span style={{ fg: theme.success }}>█</span>{" "}
                      <span style={{ fg: theme.textMuted }}>Completed ({st.completed})</span>
                    </text>
                    <text>
                      <span style={{ fg: theme.primary }}>█</span>{" "}
                      <span style={{ fg: theme.textMuted }}>Processing ({st.processing})</span>
                    </text>
                    <text>
                      <span style={{ fg: theme.warning }}>█</span>{" "}
                      <span style={{ fg: theme.textMuted }}>Queued ({st.queued})</span>
                    </text>
                    <text>
                      <span style={{ fg: theme.error }}>█</span>{" "}
                      <span style={{ fg: theme.textMuted }}>Failed ({st.failed})</span>
                    </text>
                  </box>
                </box>
              </Show>

              {/* ===== Queue Breakdown with Inline Bars ===== */}
              <Show when={total > 0}>
                <box flexDirection="column" gap={1} paddingY={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Queue Breakdown
                  </text>
                  <box flexDirection="column" gap={0} paddingLeft={1}>
                    <BreakdownRow
                      label="Queued"
                      value={st.queued}
                      total={total}
                      color={theme.warning}
                    />
                    <BreakdownRow
                      label="Processing"
                      value={st.processing}
                      total={total}
                      color={theme.primary}
                    />
                    <BreakdownRow
                      label="Completed"
                      value={st.completed}
                      total={total}
                      color={theme.success}
                    />
                    <BreakdownRow
                      label="Failed"
                      value={st.failed}
                      total={total}
                      color={theme.error}
                    />
                  </box>
                </box>
              </Show>

              {/* ===== Status Line ===== */}
              <box paddingY={1}>
                <text fg={st.polling_active ? theme.success : theme.warning}>
                  {st.polling_active ? "●" : "○"}{" "}
                  {st.polling_active
                    ? "Polling active — auto-refreshes every 10s"
                    : "Polling inactive"}
                </text>
              </box>

              {/* ===== Repositories List ===== */}
              <Show when={st.repos.length > 0}>
                <box flexDirection="column" gap={1} paddingY={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Repositories ({st.repos.length})
                  </text>
                  <For each={st.repos}>
                    {(repo) => (
                      <box flexDirection="row" gap={1} paddingLeft={2}>
                        <text fg={theme.primary}>●</text>
                        <text fg={theme.text}>{repo}</text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              {/* ===== Empty State ===== */}
              <Show when={total === 0 && st.repos.length === 0 && !error()}>
                <box paddingY={2}>
                  <text fg={theme.textMuted}>
                    No symphony queue data available. The queue system may not be configured.
                  </text>
                </box>
              </Show>
            </>
          )
        }}
      </Show>
    </box>
  )
}
