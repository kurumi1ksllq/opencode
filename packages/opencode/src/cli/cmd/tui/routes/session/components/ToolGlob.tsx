import { Show } from "solid-js"
import { usePathFormatter } from "../../../context/path-format"
import type { GlobTool } from "@/tool/glob"
import { InlineTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function Glob(props: ToolProps<typeof GlobTool>) {
  const pathFormatter = usePathFormatter()
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
      Glob &quot;{props.input.pattern}&quot; <Show when={props.input.path}>in {pathFormatter.format(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}
