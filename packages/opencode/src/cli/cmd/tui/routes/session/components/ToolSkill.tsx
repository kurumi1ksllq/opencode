import type { SkillTool } from "@/tool/skill"
import { InlineTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill &quot;{props.input.name}&quot;
    </InlineTool>
  )
}
