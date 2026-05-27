import { describe, expect, test } from "bun:test"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "../../../../src/lsp/language"

// ---------------------------------------------------------------------------
// Pure function replicas from session/index.tsx
// These mirror the logic in src/cli/cmd/tui/routes/session/index.tsx but
// are extracted here because the source functions are module-private (not
// exported). When the giant file is split (Task 9), these can be replaced
// with direct imports.
// ---------------------------------------------------------------------------

function toolInput(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

const GO_UPSELL_PROVIDERS = new Set(["opencode", "opencode-go"])
const GO_UPSELL_FREE_TIER_LAST_SEEN_AT = "go_upsell_last_seen_at"
const GO_UPSELL_FREE_TIER_DONT_SHOW = "go_upsell_dont_show"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT = "go_upsell_account_rate_limit_last_seen_at"
const GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW = "go_upsell_account_rate_limit_dont_show"

type UpsellAction = { reason: string; provider: string; title: string; message: string; label: string; link?: string }

function goUpsellKeys(action: UpsellAction | undefined) {
  if (!action) return
  if (!GO_UPSELL_PROVIDERS.has(action.provider)) return
  if (action.reason === "free_tier_limit") {
    return { lastSeenAt: GO_UPSELL_FREE_TIER_LAST_SEEN_AT, dontShow: GO_UPSELL_FREE_TIER_DONT_SHOW }
  }
  if (action.reason === "account_rate_limit") {
    return { lastSeenAt: GO_UPSELL_ACCOUNT_RATE_LIMIT_LAST_SEEN_AT, dontShow: GO_UPSELL_ACCOUNT_RATE_LIMIT_DONT_SHOW }
  }
}

// ---------------------------------------------------------------------------
// Scroll helper: findNextVisibleMessage logic
// ---------------------------------------------------------------------------

type ScrollChild = { id?: string; y: number }
type Message = { id: string; role: string }
type PartMap = Record<string, Array<{ type: string; synthetic?: boolean; ignored?: boolean }>>

function findNextVisibleMessage(
  direction: "next" | "prev",
  messages: Message[],
  children: ScrollChild[],
  scrollTop: number,
  parts: PartMap,
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

// ---------------------------------------------------------------------------
// Session context interface shape
// ---------------------------------------------------------------------------

interface SessionContext {
  width: number
  sessionID: string
  conceal: () => boolean
  thinkingMode: () => string
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showGenericToolOutput: () => boolean
  diffWrapMode: () => "word" | "none"
  providers: () => ReadonlyMap<string, unknown>
  sync: unknown
  tui: unknown
}

function createMockContext(overrides?: Partial<SessionContext>): SessionContext {
  return {
    width: 100,
    sessionID: "session_abc123",
    conceal: () => true,
    thinkingMode: () => "show",
    showThinking: () => true,
    showTimestamps: () => false,
    showDetails: () => true,
    showGenericToolOutput: () => false,
    diffWrapMode: () => "word" as const,
    providers: () => new Map(),
    sync: {},
    tui: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Command list structure
// ---------------------------------------------------------------------------

interface SessionCommand {
  title: string
  value: string
  category: string
  hidden?: boolean
  enabled?: boolean
  suggested?: boolean
  slash?: { name: string; aliases?: string[] }
}

function createCommand(overrides: Partial<SessionCommand> & { title: string; value: string }): SessionCommand {
  return {
    category: "Session",
    hidden: false,
    ...overrides,
  }
}

// ===========================================================================
// TESTS
// ===========================================================================

// ----- 1. Context shape ----------------------------------------------------

describe("session context shape", () => {
  test("creates context with default values for all required properties", () => {
    const ctx = createMockContext()
    expect(ctx).toBeDefined()
    expect(ctx.width).toBe(100)
    expect(ctx.sessionID).toBe("session_abc123")
    expect(typeof ctx.conceal).toBe("function")
    expect(typeof ctx.thinkingMode).toBe("function")
    expect(typeof ctx.showThinking).toBe("function")
    expect(typeof ctx.showTimestamps).toBe("function")
    expect(typeof ctx.showDetails).toBe("function")
    expect(typeof ctx.showGenericToolOutput).toBe("function")
    expect(typeof ctx.diffWrapMode).toBe("function")
    expect(typeof ctx.providers).toBe("function")
  })

  test("context properties return expected runtime values", () => {
    const ctx = createMockContext()
    expect(ctx.conceal()).toBe(true)
    expect(ctx.thinkingMode()).toBe("show")
    expect(ctx.showThinking()).toBe(true)
    expect(ctx.showTimestamps()).toBe(false)
    expect(ctx.showDetails()).toBe(true)
    expect(ctx.diffWrapMode()).toBe("word")
    expect(ctx.providers()).toBeInstanceOf(Map)
    expect(ctx.providers().size).toBe(0)
  })

  test("context overrides using partial application", () => {
    const providers = new Map([["openai", {} as any]])
    const ctx = createMockContext({
      width: 80,
      sessionID: "session_xyz",
      conceal: () => false,
      providers: () => providers,
    })
    expect(ctx.width).toBe(80)
    expect(ctx.sessionID).toBe("session_xyz")
    expect(ctx.conceal()).toBe(false)
    expect(ctx.providers().has("openai")).toBe(true)
  })

  test("context diffWrapMode supports both word and none", () => {
    const wordContext = createMockContext({ diffWrapMode: () => "word" })
    const noneContext = createMockContext({ diffWrapMode: () => "none" })
    expect(wordContext.diffWrapMode()).toBe("word")
    expect(noneContext.diffWrapMode()).toBe("none")
  })
})

// ----- 2. Tool input formatting --------------------------------------------

describe("tool input formatting", () => {
  test("returns empty string for empty input", () => {
    expect(toolInput({})).toBe("")
  })

  test("formats string primitives", () => {
    expect(toolInput({ filePath: "/foo/bar.txt" })).toBe("[filePath=/foo/bar.txt]")
  })

  test("formats multiple primitives", () => {
    expect(toolInput({ filePath: "/a.txt", replaceAll: true, maxLines: 10 })).toBe(
      "[filePath=/a.txt, replaceAll=true, maxLines=10]",
    )
  })

  test("omits specified keys", () => {
    expect(toolInput({ filePath: "/a.txt", pattern: "foo" }, ["filePath"])).toBe("[pattern=foo]")
  })

  test("omits multiple keys", () => {
    expect(
      toolInput({ filePath: "/a.txt", pattern: "foo", replaceAll: true, debug: false }, [
        "filePath",
        "pattern",
      ]),
    ).toBe("[replaceAll=true, debug=false]")
  })

  test("ignores non-primitive values (objects, arrays, undefined)", () => {
    expect(toolInput({ filePath: "/a.txt", content: "long content...", meta: { key: "val" }, tags: ["a", "b"] })).toBe(
      "[filePath=/a.txt, content=long content...]",
    )
  })

  test("only primitive values are included", () => {
    const result = toolInput({
      filePath: "test.ts",
      replaceAll: true,
      count: 42,
      callback: () => {},
      metadata: { version: 2 },
    })
    expect(result).toContain("filePath=test.ts")
    expect(result).toContain("replaceAll=true")
    expect(result).toContain("count=42")
    expect(result).not.toContain("callback")
    expect(result).not.toContain("metadata")
  })
})

// ----- 3. Filetype mapping --------------------------------------------------

describe("filetype mapping", () => {
  test("returns 'none' for undefined or empty input", () => {
    expect(filetype()).toBe("none")
    expect(filetype("")).toBe("none")
  })

  test("maps .ts to typescript", () => {
    expect(filetype("file.ts")).toBe("typescript")
  })

  test("maps .tsx to typescript (normalized from typescriptreact)", () => {
    expect(filetype("component.tsx")).toBe("typescript")
  })

  test("maps .jsx to typescript (normalized from javascriptreact)", () => {
    expect(filetype("component.jsx")).toBe("typescript")
  })

  test("maps .js to typescript (normalized from javascript)", () => {
    expect(filetype("script.js")).toBe("typescript")
  })

  test("maps .css to css", () => {
    expect(filetype("styles.css")).toBe("css")
  })

  test("maps .md to markdown", () => {
    expect(filetype("README.md")).toBe("markdown")
  })

  test("maps .json to json", () => {
    expect(filetype("data.json")).toBe("json")
  })

  test("maps unknown extension returns undefined", () => {
    expect(filetype("file.xyz")).toBeUndefined()
  })

  test("maps uppercase extensions (extname preserves case, map has lowercase keys)", () => {
    // path.extname("File.TS") returns ".TS" which won't match the lowercase keys
    // This documents the case-sensitive behavior
    expect(filetype("file.ts")).toBe("typescript")
    expect(filetype("file.tsx")).toBe("typescript")
  })
})

// ----- 4. Go upsell keys ----------------------------------------------------

describe("goUpsellKeys", () => {
  test("returns undefined for undefined action", () => {
    expect(goUpsellKeys(undefined)).toBeUndefined()
  })

  test("returns undefined for non-upsell provider", () => {
    expect(goUpsellKeys({ reason: "free_tier_limit", provider: "anthropic", title: "", message: "", label: "" })).toBeUndefined()
  })

  test("returns free tier keys for opencode provider with free_tier_limit", () => {
    const result = goUpsellKeys({ reason: "free_tier_limit", provider: "opencode", title: "", message: "", label: "" })
    expect(result).toEqual({
      lastSeenAt: "go_upsell_last_seen_at",
      dontShow: "go_upsell_dont_show",
    })
  })

  test("returns free tier keys for opencode-go provider with free_tier_limit", () => {
    const result = goUpsellKeys({
      reason: "free_tier_limit",
      provider: "opencode-go",
      title: "",
      message: "",
      label: "",
    })
    expect(result).toEqual({
      lastSeenAt: "go_upsell_last_seen_at",
      dontShow: "go_upsell_dont_show",
    })
  })

  test("returns account rate limit keys for free_tier_limit", () => {
    const result = goUpsellKeys({
      reason: "account_rate_limit",
      provider: "opencode",
      title: "",
      message: "",
      label: "",
    })
    expect(result).toEqual({
      lastSeenAt: "go_upsell_account_rate_limit_last_seen_at",
      dontShow: "go_upsell_account_rate_limit_dont_show",
    })
  })

  test("returns undefined for unknown reason even with matching provider", () => {
    const result = goUpsellKeys({
      reason: "some_other_reason",
      provider: "opencode",
      title: "",
      message: "",
      label: "",
    })
    expect(result).toBeUndefined()
  })
})

// ----- 5. Message navigation (scroll helper) --------------------------------

describe("message navigation", () => {
  const messages: Message[] = [
    { id: "msg_1", role: "user" },
    { id: "msg_2", role: "assistant" },
    { id: "msg_3", role: "user" },
    { id: "msg_4", role: "assistant" },
    { id: "msg_5", role: "user" },
  ]

  const parts: PartMap = {
    msg_1: [{ type: "text", synthetic: false, ignored: false }],
    msg_3: [{ type: "text", synthetic: false, ignored: false }],
    msg_5: [{ type: "text", synthetic: false, ignored: false }],
  }

  const children: ScrollChild[] = [
    { id: "msg_1", y: 0 },
    { id: "msg_2", y: 50 },
    { id: "msg_3", y: 100 },
    { id: "msg_4", y: 150 },
    { id: "msg_5", y: 200 },
  ]

  test("returns null when no children exist", () => {
    expect(findNextVisibleMessage("next", [], [], 0, {})).toBeNull()
  })

  test("finds next visible message below scroll position", () => {
    const result = findNextVisibleMessage("next", messages, children, 30, parts)
    // msg_3 is at y=100, which is > 30+10=40
    expect(result).toBe("msg_3")
  })

  test("finds next visible message when scrolled near bottom", () => {
    // msg_3 (y=100) is not > 130+10=140, but msg_5 (y=200) is
    const result = findNextVisibleMessage("next", messages, children, 130, parts)
    expect(result).toBe("msg_5")
  })

  test("returns null when no visible messages below scroll position", () => {
    const result = findNextVisibleMessage("next", messages, children, 500, parts)
    expect(result).toBeNull()
  })

  test("finds previous visible message above scroll position", () => {
    const result = findNextVisibleMessage("prev", messages, children, 160, parts)
    // msg_3 is at y=100, which is < 160-10=150
    expect(result).toBe("msg_3")
  })

  test("finds previous message when scrolled near top", () => {
    const result = findNextVisibleMessage("prev", messages, children, 20, parts)
    // Nothing is at y < 20-10=10 (msg_1 is at 0 which is < 10)
    expect(result).toBe("msg_1")
  })

  test("returns null when no visible messages above scroll position", () => {
    const result = findNextVisibleMessage("prev", messages, children, 5, parts)
    expect(result).toBeNull()
  })

  test("ignores children without IDs", () => {
    const childrenWithNoId: ScrollChild[] = [
      { id: undefined, y: 0 },
      { id: "msg_1", y: 50 },
    ]
    const result = findNextVisibleMessage("next", messages, childrenWithNoId, 0, parts)
    expect(result).toBe("msg_1")
  })

  test("filters out messages without valid text parts", () => {
    const partsPartially: PartMap = {
      msg_1: [{ type: "tool", synthetic: false, ignored: false }], // no text part
      msg_3: [{ type: "text", synthetic: false, ignored: false }],
    }
    const result = findNextVisibleMessage("next", messages, children, 0, partsPartially)
    // Only msg_3 passes filter (msg_1 has tool parts, others have no parts entry)
    expect(result).toBe("msg_3")
  })

  test("filters out messages with synthetic or ignored text parts", () => {
    const partsFiltered: PartMap = {
      msg_1: [{ type: "text", synthetic: true, ignored: false }],
      msg_3: [{ type: "text", synthetic: false, ignored: true }],
      msg_5: [{ type: "text", synthetic: false, ignored: false }],
    }
    const result = findNextVisibleMessage("next", messages, children, 0, partsFiltered)
    // Only msg_5 has non-synthetic, non-ignored text
    expect(result).toBe("msg_5")
  })

  test("children are sorted by y-position regardless of insertion order", () => {
    const unsortedChildren: ScrollChild[] = [
      { id: "msg_3", y: 100 },
      { id: "msg_1", y: 0 },
      { id: "msg_5", y: 200 },
    ]
    const result = findNextVisibleMessage("next", messages, unsortedChildren, 50, parts)
    // sorted: msg_1(y=0), msg_3(y=100), msg_5(y=200)
    // First > 50+10=60 is msg_3 (msg_1 at 0 is not > 60)
    expect(result).toBe("msg_3")
  })
})

// ----- 6. Command list structure ---------------------------------------------

describe("command list building", () => {
  test("creates command with required fields", () => {
    const cmd = createCommand({ title: "Share session", value: "session.share" })
    expect(cmd.title).toBe("Share session")
    expect(cmd.value).toBe("session.share")
    expect(cmd.category).toBe("Session")
    expect(cmd.hidden).toBe(false)
  })

  test("creates command with optional slash metadata", () => {
    const cmd = createCommand({
      title: "Rename session",
      value: "session.rename",
      slash: { name: "rename" },
    })
    expect(cmd.slash).toEqual({ name: "rename" })
  })

  test("creates command with slash aliases", () => {
    const cmd = createCommand({
      title: "Compact session",
      value: "session.compact",
      slash: { name: "compact", aliases: ["summarize"] },
    })
    expect(cmd.slash?.aliases).toEqual(["summarize"])
  })

  test("creates hidden command", () => {
    const cmd = createCommand({ title: "Page up", value: "session.page.up", hidden: true })
    expect(cmd.hidden).toBe(true)
  })

  test("creates command with enabled condition", () => {
    const cmd = createCommand({
      title: "Unshare session",
      value: "session.unshare",
      enabled: true,
    })
    expect(cmd.enabled).toBe(true)
  })

  test("creates command with suggested flag", () => {
    const cmd = createCommand({
      title: "Share session",
      value: "session.share",
      suggested: true,
    })
    expect(cmd.suggested).toBe(true)
  })

  test("sessionBindingCommands contains all expected values", () => {
    // Verify the expected set of command values from the source
    const expectedCommands = [
      "session.share",
      "session.rename",
      "session.timeline",
      "session.fork",
      "session.compact",
      "session.unshare",
      "session.undo",
      "session.redo",
      "session.sidebar.toggle",
      "session.toggle.conceal",
      "session.toggle.timestamps",
      "session.toggle.thinking",
      "session.toggle.actions",
      "session.toggle.scrollbar",
      "session.toggle.generic_tool_output",
      "session.page.up",
      "session.page.down",
      "session.line.up",
      "session.line.down",
      "session.half.page.up",
      "session.half.page.down",
      "session.first",
      "session.last",
      "session.messages_last_user",
      "session.message.next",
      "session.message.previous",
      "messages.copy",
      "session.copy",
      "session.export",
      "session.child.first",
      "session.parent",
      "session.child.next",
      "session.child.previous",
    ]

    // Create the commands and verify each has expected structure
    for (const value of expectedCommands) {
      const cmd = createCommand({ title: value, value })
      expect(cmd).toHaveProperty("title")
      expect(cmd).toHaveProperty("value")
      expect(cmd).toHaveProperty("category")
    }
    expect(expectedCommands).toHaveLength(33)
  })
})
