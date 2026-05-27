import { createMemo, Show, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { usePathFormatter } from "../../../context/path-format"
import type { WriteTool } from "@/tool/write"
import { InlineTool, BlockTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"
import { filetype } from "../utils/filetype"
import { Diagnostics } from "./Diagnostics"

export function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + pathFormatter.format(props.input.filePath)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {pathFormatter.format(props.input.filePath)}
        </InlineTool>
      </Match>
    </Switch>
  )
}
