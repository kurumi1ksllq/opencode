import { describe, expect, it } from "bun:test"
import { decomposeIssue } from "@/symphony/decompose"

describe("decomposeIssue", () => {
  it("returns at least 1 task for 'Setup CI pipeline'", () => {
    const result = decomposeIssue("Setup CI pipeline")
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it("returns at least 2 tasks for 'Implement login feature with tests'", () => {
    const result = decomposeIssue("Implement login feature with tests")
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it("returns a task with 'Fix' in title for 'Fix production bug'", () => {
    const result = decomposeIssue("Fix production bug")
    expect(result.length).toBeGreaterThanOrEqual(1)
    const hasFixTask = result.some((t) => t.title.includes("Fix"))
    expect(hasFixTask).toBe(true)
  })

  it("returns empty array for empty title", () => {
    const result = decomposeIssue("")
    expect(result).toEqual([])
  })

  it("returns no more than 8 tasks for very long body with many keywords", () => {
    const body =
      "setup the project, install dependencies, then implement the login feature, " +
      "add user registration, create dashboard, build admin panel, write unit tests, " +
      "write integration tests, refactor the auth module, clean up dead code, " +
      "fix the rate limiting bug, update the README, deploy to production, " +
      "setup CI pipeline, configure CD, improve UI styling, design new logo"
    const result = decomposeIssue("Big project", body)
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it("returns at most 8 tasks for many keywords in title", () => {
    const result = decomposeIssue(
      "Refactor auth module, add logging, update docs, write tests, fix rate limiting, setup monitoring",
    )
    expect(result.length).toBeLessThanOrEqual(8)
  })

  it("returns at least 1 task for 'Add dark mode support'", () => {
    const result = decomposeIssue("Add dark mode support")
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it("generates a fix-related task when body contains 'bug' and 'fix'", () => {
    const result = decomposeIssue("User login issue", "Found a bug where login crashes. Need to fix it.")
    const hasFixTask = result.some((t) => t.title.includes("Fix"))
    expect(hasFixTask).toBe(true)
  })
})
