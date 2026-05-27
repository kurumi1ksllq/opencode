import { createMemo, createSignal, Show, Switch, Match } from "solid-js"
import { useTheme, generateSubtleSyntax } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import { Locale } from "@/util/locale"
import { reasoningTitle } from "../../../context/thinking"
import { use } from "../session-context"
import type { ReasoningPart as ReasoningPartType, AssistantMessage } from "@opencode-ai/sdk/v2"

export function ReasoningPart(props: { last: boolean; part: ReasoningPartType; message: AssistantMessage }) {
  const { theme } = useTheme()
  const ctx = use()
  const [expanded, setExpanded] = createSignal(false)

  const content = createMemo(() => {
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  const isDone = createMemo(() => props.part.time.end !== undefined)
  const inMinimal = createMemo(() => ctx.thinkingMode() === "hide")
  const duration = createMemo(() => {
    const end = props.part.time.end
    return end === undefined ? 0 : Math.max(0, end - props.part.time.start)
  })
  const title = createMemo(() => reasoningTitle(content()))
  const syntax = createMemo(() => generateSubtleSyntax(theme, { "markup.italic": { italic: false } }))

  const toggle = () => {
    if (!inMinimal()) return
    setExpanded((prev) => !prev)
  }

  return (
    <Show when={content()}>
      <Switch>
        <Match when={!inMinimal() || expanded()}>
          <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexDirection="column" onMouseUp={toggle}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={(inMinimal() ? "- " : "") + (isDone() ? "_Thought:_ " : "_Thinking:_ ") + content()}
              conceal={ctx.conceal()}
              fg={theme.textMuted}
            />
          </box>
        </Match>
        <Match when={isDone()}>
          <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0} onMouseUp={toggle}>
            <CollapsedReasoningText title={title()} duration={duration()} />
          </box>
        </Match>
        <Match when={true}>
          <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0} onMouseUp={toggle}>
            <Spinner color={theme.textMuted}>{title() ? "Thinking: " + title() : "Thinking"}</Spinner>
          </box>
        </Match>
      </Switch>
    </Show>
  )
}

function CollapsedReasoningText(props: { title: string | null; duration: number }) {
  const { theme } = useTheme()
  const duration = () => Locale.duration(props.duration)

  return (
    <text fg={theme.warning} wrapMode="none">
      <span style={{ fg: theme.warning }}>
        {props.title ? "+ Thought: " + props.title + " · " + duration() : "+ Thought: " + duration()}
      </span>
    </text>
  )
}
