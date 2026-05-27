import { type AutocompleteRef, Autocomplete } from "../autocomplete"

export type SuggestionsProps = {
  sessionID?: string
  setAuto: (r: AutocompleteRef | undefined) => void
  anchor: () => any
  input: () => any
  value: string
  fileStyleId: number
  agentStyleId: number
  promptPartTypeId: () => number
  setStorePrompt: (cb: (prev: any) => any) => void
  setStoreExtmark: (partIndex: number, extmarkId: number) => void
}

export function Suggestions(props: SuggestionsProps) {
  return (
    <Autocomplete
      sessionID={props.sessionID}
      ref={(r) => {
        props.setAuto(r)
      }}
      anchor={props.anchor}
      input={props.input}
      setPrompt={(cb) => {
        props.setStorePrompt(cb)
      }}
      setExtmark={(partIndex, extmarkId) => {
        props.setStoreExtmark(partIndex, extmarkId)
      }}
      value={props.value}
      fileStyleId={props.fileStyleId}
      agentStyleId={props.agentStyleId}
      promptPartTypeId={props.promptPartTypeId}
    />
  )
}
