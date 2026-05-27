import { Show } from "solid-js"
import type { AssistantMessage, TextPart } from "@opencode-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { use } from "../session-context"

export function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
        <markdown
          syntaxStyle={syntax()}
          streaming={true}
          internalBlockMode="top-level"
          content={props.part.text.trim()}
          tableOptions={{ style: "grid" }}
          conceal={ctx.conceal()}
          fg={theme.markdownText}
          bg={theme.background}
        />
      </box>
    </Show>
  )
}
