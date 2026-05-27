import { Show } from "solid-js"
import { webSearchProviderLabel, type WebSearchTool } from "@/tool/websearch"
import { InlineTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function WebSearch(props: ToolProps<typeof WebSearchTool>) {
  const metadata = () => props.metadata as { numResults?: number; provider?: unknown }
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={props.input.query} part={props.part}>
      {webSearchProviderLabel(metadata().provider)} &quot;{props.input.query}&quot;{" "}
      <Show when={metadata().numResults}>({metadata().numResults} results)</Show>
    </InlineTool>
  )
}
