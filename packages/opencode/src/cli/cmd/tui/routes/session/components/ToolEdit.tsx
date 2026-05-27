import { createMemo, Show, Switch, Match } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { usePathFormatter } from "../../../context/path-format"
import { use } from "../session-context"
import type { EditTool } from "@/tool/edit"
import { InlineTool, BlockTool, input } from "./ToolPart"
import type { ToolProps } from "./ToolPart"
import { filetype } from "../utils/filetype"
import { Diagnostics } from "./Diagnostics"

export function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const pathFormatter = usePathFormatter()

  const view = createMemo(() => {
    const diffStyle = ctx.tui.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + pathFormatter.format(props.input.filePath)} part={props.part}>
          <box paddingLeft={1}>
            <diff
              diff={diffContent()}
              view={view()}
              filetype={ft()}
              syntaxStyle={syntax()}
              showLineNumbers={true}
              width="100%"
              wrapMode={ctx.diffWrapMode()}
              fg={theme.text}
              addedBg={theme.diffAddedBg}
              removedBg={theme.diffRemovedBg}
              contextBg={theme.diffContextBg}
              addedSignColor={theme.diffHighlightAdded}
              removedSignColor={theme.diffHighlightRemoved}
              lineNumberFg={theme.diffLineNumber}
              lineNumberBg={theme.diffContextBg}
              addedLineNumberBg={theme.diffAddedLineNumberBg}
              removedLineNumberBg={theme.diffRemovedLineNumberBg}
            />
          </box>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={props.input.filePath ?? ""} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
          Edit {pathFormatter.format(props.input.filePath)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}
