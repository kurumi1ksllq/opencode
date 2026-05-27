import type { ScrollBoxRenderable } from "@opentui/core"

export function findNextVisibleMessage(
  direction: "next" | "prev",
  messages: Array<{ id: string; role: string }>,
  children: Array<{ id?: string; y: number }>,
  scrollTop: number,
  parts: Record<string, Array<{ type: string; synthetic?: boolean; ignored?: boolean }>>,
): string | null {
  const visibleMessages = children
    .filter((c) => {
      if (!c.id) return false
      const message = messages.find((m) => m.id === c.id)
      if (!message) return false
      const msgParts = parts[message.id]
      if (!msgParts || !Array.isArray(msgParts)) return false
      return msgParts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
    })
    .sort((a, b) => a.y - b.y)

  if (visibleMessages.length === 0) return null

  if (direction === "next") {
    return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
  }
  return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
}

export function scrollToMessage(
  direction: "next" | "prev",
  scroll: ScrollBoxRenderable,
  messages: Array<{ id: string; role: string }>,
  dialog: { clear: () => void },
  parts: Record<string, Array<{ type: string; synthetic?: boolean; ignored?: boolean }>>,
) {
  const targetID = findNextVisibleMessage(
    direction,
    messages,
    scroll.getChildren(),
    scroll.y,
    parts,
  )

  if (!targetID) {
    scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
    dialog.clear()
    return
  }

  const child = scroll.getChildren().find((c) => c.id === targetID)
  if (child) scroll.scrollBy(child.y - scroll.y - 1)
  dialog.clear()
}

export function toBottom(scroll: ScrollBoxRenderable) {
  setTimeout(() => {
    if (!scroll || scroll.isDestroyed) return
    scroll.scrollTo(scroll.scrollHeight)
  }, 50)
}
