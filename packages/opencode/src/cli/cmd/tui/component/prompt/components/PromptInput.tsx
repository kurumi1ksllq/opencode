import { Show } from "solid-js"
import { RGBA, type MouseEvent, type PasteEvent, type TextareaRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { EmptyBorder, SplitBorder } from "@tui/component/border"
import { Locale } from "@/util/locale"
import { useTheme } from "@tui/context/theme"
import { useLeaderActive } from "../../../keymap"
import { useLocal } from "@tui/context/local"
import { fadeColor, type PromptRef } from "../prompt-context"

export type PromptInputProps = {
  disabled?: boolean
  mode: "normal" | "shell"
  placeholderText: string | undefined
  borderHighlight: RGBA
  highlight: RGBA
  agentMetaAlpha: number
  modelMetaAlpha: number
  variantMetaAlpha: number
  showVariant: boolean
  hasRightContent: boolean
  right?: JSX.Element
  currentProviderLabel: string
  onContentChange: () => void
  onCursorChange: () => void
  onKeyDown: (e: { preventDefault(): void }) => void
  onSubmit: () => void
  onPaste: (event: PasteEvent) => Promise<void>
  textareaRef: (r: TextareaRenderable) => void
  cursorColor: RGBA
  promptRef?: (ref: PromptRef | undefined) => void
}

export function PromptInput(props: PromptInputProps) {
  const { theme, syntax } = useTheme()
  const leader = useLeaderActive()
  const local = useLocal()

  return (
    <>
      <box
        border={["left"]}
        borderColor={props.borderHighlight}
        customBorderChars={{
          ...SplitBorder.customBorderChars,
          bottomLeft: "╹",
        }}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
        >
          <textarea
            placeholder={props.placeholderText}
            placeholderColor={theme.textMuted}
            textColor={leader() ? theme.textMuted : theme.text}
            focusedTextColor={leader() ? theme.textMuted : theme.text}
            minHeight={1}
            maxHeight={6}
            onContentChange={props.onContentChange}
            onCursorChange={props.onCursorChange}
            onKeyDown={props.onKeyDown}
            onSubmit={props.onSubmit}
            onPaste={props.onPaste}
            ref={props.textareaRef}
            onMouseDown={(r: MouseEvent) => r.target?.focus()}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={props.cursorColor}
            syntaxStyle={syntax()}
          />
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1}>
              <Show when={local.agent.current()} fallback={<box height={1} />}>
                {(agent) => (
                  <>
                    <text fg={fadeColor(props.highlight, props.agentMetaAlpha)}>
                      {props.mode === "shell" ? "Shell" : Locale.titlecase(agent().name)}
                    </text>
                    <Show when={props.mode === "normal"}>
                      <box flexDirection="row" gap={1}>
                        <text fg={fadeColor(theme.textMuted, props.modelMetaAlpha)}>·</text>
                        <text
                          flexShrink={0}
                          fg={fadeColor(leader() ? theme.textMuted : theme.text, props.modelMetaAlpha)}
                        >
                          {local.model.parsed().model}
                        </text>
                        <text fg={fadeColor(theme.textMuted, props.modelMetaAlpha)}>{props.currentProviderLabel}</text>
                        <Show when={props.showVariant}>
                          <text fg={fadeColor(theme.textMuted, props.variantMetaAlpha)}>·</text>
                          <text>
                            <span style={{ fg: fadeColor(theme.warning, props.variantMetaAlpha), bold: true }}>
                              {local.model.variant.current()}
                            </span>
                          </text>
                        </Show>
                      </box>
                    </Show>
                  </>
                )}
              </Show>
            </box>
            <Show when={props.hasRightContent}>
              <box flexDirection="row" gap={1} alignItems="center">
                {props.right}
              </box>
            </Show>
          </box>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={props.borderHighlight}
        customBorderChars={{
          ...EmptyBorder,
          vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
        }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.backgroundElement}
          customBorderChars={
            theme.backgroundElement.a !== 0
              ? {
                  ...EmptyBorder,
                  horizontal: "▀",
                }
              : {
                  ...EmptyBorder,
                  horizontal: " ",
                }
          }
        />
      </box>
    </>
  )
}
