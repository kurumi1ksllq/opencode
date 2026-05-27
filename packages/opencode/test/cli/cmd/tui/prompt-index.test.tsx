import { describe, expect, test } from "bun:test"
import {
  hasEditorRangeSelection,
  getEditorRangeLabel,
  formatEditorContext,
} from "../../../../src/cli/cmd/tui/component/prompt/index"
import type { EditorSelection } from "../../../../src/cli/cmd/tui/context/editor"

function range(overrides: Partial<EditorSelection["ranges"][number]> = {}): EditorSelection["ranges"][number] {
  return {
    text: "const x = 1",
    selection: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 11 },
    },
    ...overrides,
  }
}

function selection(overrides: Partial<EditorSelection> = {}): EditorSelection {
  return {
    filePath: "/project/src/main.ts",
    ranges: [range()],
    ...overrides,
  }
}

describe("hasEditorRangeSelection", () => {
  test("returns false when start and end are identical", () => {
    const r = range({
      selection: {
        start: { line: 5, character: 10 },
        end: { line: 5, character: 10 },
      },
    })
    expect(hasEditorRangeSelection(r)).toBe(false)
  })

  test("returns true when lines differ", () => {
    const r = range({
      selection: {
        start: { line: 5, character: 10 },
        end: { line: 10, character: 0 },
      },
    })
    expect(hasEditorRangeSelection(r)).toBe(true)
  })

  test("returns true when only characters differ on same line", () => {
    const r = range({
      selection: {
        start: { line: 5, character: 10 },
        end: { line: 5, character: 20 },
      },
    })
    expect(hasEditorRangeSelection(r)).toBe(true)
  })
})

describe("getEditorRangeLabel", () => {
  test("returns undefined when there is no range selection", () => {
    const r = range({
      selection: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 0 },
      },
    })
    expect(getEditorRangeLabel(r)).toBeUndefined()
  })

  test("formats single-line selection as #N", () => {
    const r = range({
      selection: {
        start: { line: 7, character: 4 },
        end: { line: 7, character: 16 },
      },
    })
    expect(getEditorRangeLabel(r)).toBe("#7")
  })

  test("formats multi-line selection as #N-M", () => {
    const r = range({
      selection: {
        start: { line: 3, character: 0 },
        end: { line: 8, character: 5 },
      },
    })
    expect(getEditorRangeLabel(r)).toBe("#3-8")
  })
})

describe("formatEditorContext", () => {
  test("returns file-open context when no range is selected", () => {
    const sel = selection({
      ranges: [
        {
          text: "",
          selection: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      ],
    })
    const result = formatEditorContext(sel)
    expect(result).toContain('opened the file "/project/src/main.ts"')
    expect(result).toContain("<system-reminder>")
    expect(result).not.toContain("Selection")
  })

  test("formats single selection context", () => {
    const sel = selection({
      ranges: [
        {
          text: "function foo() {}",
          selection: {
            start: { line: 10, character: 0 },
            end: { line: 12, character: 1 },
          },
        },
      ],
    })
    const result = formatEditorContext(sel)
    expect(result).toContain("#10-12")
    expect(result).toContain("function foo() {}")
    expect(result).not.toContain("Selection 1:")
  })

  test("formats multi-selection context with numbered prefixes", () => {
    const sel = selection({
      ranges: [
        {
          text: "const a = 1",
          selection: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 12 },
          },
        },
        {
          text: "const b = 2",
          selection: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 12 },
          },
        },
      ],
    })
    const result = formatEditorContext(sel)
    expect(result).toContain("Selection 1: #1")
    expect(result).toContain("Selection 2: #5")
    expect(result).toContain("const a = 1")
    expect(result).toContain("const b = 2")
  })

  test("omits empty ranges from the context output", () => {
    const sel = selection({
      ranges: [
        {
          text: "",
          selection: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
        {
          text: "const c = 3",
          selection: {
            start: { line: 3, character: 0 },
            end: { line: 3, character: 12 },
          },
        },
      ],
    })
    const result = formatEditorContext(sel)
    expect(result).not.toContain("Selection 1:")
    expect(result).toContain("#3")
    expect(result).toContain("const c = 3")
  })
})
