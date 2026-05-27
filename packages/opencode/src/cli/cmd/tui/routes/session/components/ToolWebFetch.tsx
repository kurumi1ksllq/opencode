import type { WebFetchTool } from "@/tool/webfetch"
import { InlineTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={props.input.url} part={props.part}>
      WebFetch {props.input.url}
    </InlineTool>
  )
}
