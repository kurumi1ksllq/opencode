import { Show, Switch, Match, For } from "solid-js"
import { TodoItem } from "../../../component/todo-item"
import type { TodoWriteTool } from "@/tool/todo"
import { InlineTool, BlockTool } from "./ToolPart"
import type { ToolProps } from "./ToolPart"

export function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}
