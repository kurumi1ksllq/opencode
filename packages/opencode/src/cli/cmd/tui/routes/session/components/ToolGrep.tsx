import { Show } from "solid-js"
import { usePathFormatter } from "../../../context/path-format"
import type { GrepTool } from "@/tool/grep"
import { InlineTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function Grep(props: ToolProps<typeof GrepTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
      Grep &quot;{props.input.pattern}&quot; <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}
