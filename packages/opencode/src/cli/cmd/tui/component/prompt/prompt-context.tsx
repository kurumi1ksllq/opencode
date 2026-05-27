import { RGBA } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import type { PromptInfo } from "./history"

export type PromptProps = {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  hint?: JSX.Element
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}

export type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
  reset(): void
  blur(): void
  focus(): void
  submit(): void
}

export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export const DRAFT_RETENTION_MIN_CHARS = 20

export function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

export function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}
