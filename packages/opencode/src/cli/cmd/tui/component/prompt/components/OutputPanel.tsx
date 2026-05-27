import { Match, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"

export type OutputPanelProps = {
  status: () => { type: string }
  mode: "normal" | "shell"
  editorContextLabelState: () => string
  editorFileLabelDisplay: () => string | undefined
  usage: () => { context: string; cost: string | undefined } | undefined
  agentShortcut: () => string
  paletteShortcut: () => string
}

export function OutputPanel(props: OutputPanelProps) {
  const { theme } = useTheme()

  return (
    <Show when={props.status().type !== "retry"}>
      <box gap={2} flexDirection="row">
        <Show when={props.editorContextLabelState() !== "none" ? props.editorFileLabelDisplay() : undefined}>
          {(file) => (
            <text fg={props.editorContextLabelState() === "pending" ? theme.secondary : theme.textMuted}>
              {file()}
            </text>
          )}
        </Show>
        <Switch>
          <Match when={props.mode === "normal"}>
            <Switch>
              <Match when={props.usage()}>
                {(item) => (
                  <text fg={theme.textMuted} wrapMode="none">
                    {[item().context, item().cost].filter(Boolean).join(" · ")}
                  </text>
                )}
              </Match>
              <Match when={true}>
                <text fg={theme.text}>
                  {props.agentShortcut()} <span style={{ fg: theme.textMuted }}>agents</span>
                </text>
              </Match>
            </Switch>
            <text fg={theme.text}>
              {props.paletteShortcut()} <span style={{ fg: theme.textMuted }}>commands</span>
            </text>
          </Match>
          <Match when={props.mode === "shell"}>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
            </text>
          </Match>
        </Switch>
      </box>
    </Show>
  )
}
