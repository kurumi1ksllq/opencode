import { createSignal, For, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { useDialog } from "../../../ui/dialog"
import { useCommandShortcut, useOpencodeKeymap } from "../../../keymap"

interface RevertData {
  messageID: string
  reverted: { id: string }[]
  diff?: string
  diffFiles: { filename: string; additions: number; deletions: number }[]
}

export function RevertInfo(props: { revert: RevertData }) {
  const redoShortcut = useCommandShortcut("session.redo")
  const [hover, setHover] = createSignal(false)
  const dialog = useDialog()
  const keymap = useOpencodeKeymap()
  const { theme } = useTheme()

  const handleUnrevert = async () => {
    const confirmed = await DialogConfirm.show(
      dialog,
      "Confirm Redo",
      "Are you sure you want to restore the reverted messages?",
    )
    if (confirmed) {
      keymap.dispatchCommand("session.redo")
    }
  }

  return (
    <box
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={handleUnrevert}
      marginTop={1}
      flexShrink={0}
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.backgroundPanel}
    >
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>{props.revert.reverted.length} message reverted</text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.text }}>{redoShortcut()}</span> or /redo to restore
        </text>
        <Show when={props.revert.diffFiles?.length}>
          <box marginTop={1}>
            <For each={props.revert.diffFiles}>
              {(file) => (
                <text fg={theme.text}>
                  {file.filename}
                  <Show when={file.additions > 0}>
                    <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                  </Show>
                  <Show when={file.deletions > 0}>
                    <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                  </Show>
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
