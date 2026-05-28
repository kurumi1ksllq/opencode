import { describe, it, expect } from "bun:test"
import { TaskDef, TaskID } from "@/symphony/schema"
import {
  validateDag,
  topologicalSort,
  getReadyTasks,
  markFailedDependents,
  isPlanComplete,
} from "@/symphony/plan"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uid = () => crypto.randomUUID().slice(0, 8) as TaskID

function mkId(id: string): TaskID {
  return id as TaskID
}

function task(overrides: Partial<{
  id: TaskID
  plan_id: string
  title: string
  description: string
  acceptance_criteria: string[]
  depends_on: string[]
  prompt_template: string
  status: "pending" | "ready" | "in_progress" | "completed" | "failed" | "skipped"
  result: string
  assigned_to: string
  created_at: number
  updated_at: number
}> = {}) {
  const now = Date.now()
  return new TaskDef({
    id: overrides.id ?? uid(),
    plan_id: overrides.plan_id ?? "plan-1",
    title: overrides.title ?? "Test Task",
    description: overrides.description ?? "",
    acceptance_criteria: overrides.acceptance_criteria ?? [],
    depends_on: overrides.depends_on ?? [],
    prompt_template: overrides.prompt_template ?? "",
    status: overrides.status ?? "pending",
    result: overrides.result,
    assigned_to: overrides.assigned_to,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  })
}

// ---------------------------------------------------------------------------
// validateDag
// ---------------------------------------------------------------------------

describe("validateDag", () => {
  it("empty DAG is valid", () => {
    const result = validateDag([])
    expect(result.valid).toBe(true)
    expect(result.cycles).toEqual([])
  })

  it("single node with no deps is valid", () => {
    const result = validateDag([[]])
    expect(result.valid).toBe(true)
    expect(result.cycles).toEqual([])
  })

  it("linear chain A→B→C is valid", () => {
    const deps = [["B"], ["C"], []] // A→B, B→C, C→none
    const result = validateDag(deps)
    expect(result.valid).toBe(true)
    expect(result.cycles).toEqual([])
  })

  it("diamond A→B, A→C, B→D, C→D is valid", () => {
    // A→B, A→C, B→D, C→D
    const deps = [["B", "C"], ["D"], ["D"], []]
    const result = validateDag(deps)
    expect(result.valid).toBe(true)
    expect(result.cycles).toEqual([])
  })

  it("self-loop A→A is invalid", () => {
    const deps = [["A"]]
    const result = validateDag(deps, ["A"])
    expect(result.valid).toBe(false)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it("cycle A→B→C→A is invalid", () => {
    const deps = [["B"], ["C"], ["A"]]
    const result = validateDag(deps, ["A", "B", "C"])
    expect(result.valid).toBe(false)
    expect(result.cycles.length).toBeGreaterThan(0)
  })

  it("cycle is reported with correct node order", () => {
    // A→B→C→A
    const deps = [["B"], ["C"], ["A"]]
    const result = validateDag(deps, ["A", "B", "C"])
    expect(result.valid).toBe(false)
    // The cycle should be A→B→C→A (any rotation is acceptable)
    const cycle = result.cycles[0]
    expect(cycle.length).toBe(4) // v→...→v, start=end
    expect(cycle[0]).toBe(cycle[cycle.length - 1]) // first = last
    // Verify all three nodes are in the cycle
    expect(cycle).toContain("A")
    expect(cycle).toContain("B")
    expect(cycle).toContain("C")
  })
})

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
  it("empty list returns empty list", () => {
    expect(topologicalSort([])).toEqual([])
  })

  it("single task with no deps returns that task", () => {
    const t = task({ id: mkId("A") })
    const result = topologicalSort([t])
    expect(result.length).toBe(1)
    expect(result[0].id).toBe(mkId("A"))
  })

  it("linear chain A→B→C returns tasks in order", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: ["B"] }),
      task({ id: mkId("B"), depends_on: ["C"] }),
      task({ id: mkId("C"), depends_on: [] }),
    ]
    const result = topologicalSort(tasks)
    expect(result.length).toBe(3)
    // C must come before B must come before A
    const ids = result.map((t) => t.id)
    expect(ids.indexOf(mkId("C"))).toBeLessThan(ids.indexOf(mkId("B")))
    expect(ids.indexOf(mkId("B"))).toBeLessThan(ids.indexOf(mkId("A")))
  })

  it("diamond graph returns valid topological order", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: ["B", "C"] }),
      task({ id: mkId("B"), depends_on: ["D"] }),
      task({ id: mkId("C"), depends_on: ["D"] }),
      task({ id: mkId("D"), depends_on: [] }),
    ]
    const result = topologicalSort(tasks)
    expect(result.length).toBe(4)
    const ids = result.map((t) => t.id)
    // D must come before B and C
    expect(ids.indexOf(mkId("D"))).toBeLessThan(ids.indexOf(mkId("B")))
    expect(ids.indexOf(mkId("D"))).toBeLessThan(ids.indexOf(mkId("C")))
    // B and C must come before A
    expect(ids.indexOf(mkId("B"))).toBeLessThan(ids.indexOf(mkId("A")))
    expect(ids.indexOf(mkId("C"))).toBeLessThan(ids.indexOf(mkId("A")))
  })

  it("graph with cycle returns empty array", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: ["B"] }),
      task({ id: mkId("B"), depends_on: ["C"] }),
      task({ id: mkId("C"), depends_on: ["A"] }),
    ]
    const result = topologicalSort(tasks)
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getReadyTasks
// ---------------------------------------------------------------------------

describe("getReadyTasks", () => {
  it("empty list returns empty list", () => {
    expect(getReadyTasks([])).toEqual([])
  })

  it("all tasks with no deps are ready", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [] }),
      task({ id: mkId("B"), depends_on: [] }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready.length).toBe(2)
  })

  it("linear chain: only first task is ready", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [] }),
      task({ id: mkId("B"), depends_on: ["A"] }),
      task({ id: mkId("C"), depends_on: ["B"] }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready.length).toBe(1)
    expect(ready[0].id).toBe(mkId("A"))
  })

  it("diamond: multiple ready when root completed", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
      task({ id: mkId("B"), depends_on: ["A"] }),
      task({ id: mkId("C"), depends_on: ["A"] }),
      task({ id: mkId("D"), depends_on: ["B", "C"] }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready.length).toBe(2)
    const ids = ready.map((t) => t.id).sort()
    expect(ids).toEqual([mkId("B"), mkId("C")])
  })

  it("all blocked when no deps completed", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: ["B"] }),
      task({ id: mkId("B"), depends_on: ["C"] }),
      task({ id: mkId("C"), depends_on: ["A"] }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready).toEqual([])
  })

  it("mixed: some ready, some blocked", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }), // completed
      task({ id: mkId("B"), depends_on: ["A"] }), // dep A completed → ready
      task({ id: mkId("C"), depends_on: ["B"] }), // dep B pending → blocked
      task({ id: mkId("D"), depends_on: [], status: "pending" }), // no deps → ready
    ]
    const ready = getReadyTasks(tasks)
    expect(ready.length).toBe(2)
    const ids = ready.map((t) => t.id).sort()
    expect(ids).toEqual([mkId("B"), mkId("D")])
  })

  it("already in_progress task not returned", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "in_progress" }),
      task({ id: mkId("B"), depends_on: [], status: "pending" }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready.length).toBe(1)
    expect(ready[0].id).toBe(mkId("B"))
  })

  it("already completed task not returned", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
    ]
    const ready = getReadyTasks(tasks)
    expect(ready).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// markFailedDependents
// ---------------------------------------------------------------------------

describe("markFailedDependents", () => {
  it("single failed task with no dependents marks none", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "failed" }),
    ]
    const updated = markFailedDependents(tasks, "A")
    // Only the failed task itself should be unchanged (already failed)
    expect(updated.length).toBe(1)
    expect(updated[0].id).toBe(mkId("A"))
    expect(updated[0].status).toBe("failed")
  })

  it("linear chain: fail middle marks dependent", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "failed" }),
      task({ id: mkId("C"), depends_on: ["B"], status: "pending" }),
    ]
    const updated = markFailedDependents(tasks, "B")
    const map = new Map(updated.map((t) => [t.id, t]))
    expect(map.get(mkId("A"))!.status).toBe("completed") // unchanged
    expect(map.get(mkId("B"))!.status).toBe("failed") // unchanged (already failed)
    expect(map.get(mkId("C"))!.status).toBe("skipped") // marked skipped
  })

  it("diamond: fail one branch skips its dependents", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "failed" }),
      task({ id: mkId("C"), depends_on: ["A"], status: "pending" }),
      task({ id: mkId("D"), depends_on: ["B", "C"], status: "pending" }),
    ]
    const updated = markFailedDependents(tasks, "B")
    const map = new Map(updated.map((t) => [t.id, t]))
    expect(map.get(mkId("A"))!.status).toBe("completed")
    expect(map.get(mkId("B"))!.status).toBe("failed")
    expect(map.get(mkId("C"))!.status).toBe("pending") // other branch unchanged
    expect(map.get(mkId("D"))!.status).toBe("skipped") // depends on B → skipped
  })

  it("leaf task failure does not skip anyone", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "completed" }),
      task({ id: mkId("C"), depends_on: ["B"], status: "failed" }),
    ]
    const updated = markFailedDependents(tasks, "C")
    const map = new Map(updated.map((t) => [t.id, t]))
    expect(map.get(mkId("A"))!.status).toBe("completed")
    expect(map.get(mkId("B"))!.status).toBe("completed")
    expect(map.get(mkId("C"))!.status).toBe("failed")
    expect(updated.length).toBe(3)
  })

  it("completed tasks are not changed", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "completed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "completed" }),
    ]
    const updated = markFailedDependents(tasks, "A")
    const map = new Map(updated.map((t) => [t.id, t.status]))
    expect(map.get(mkId("A"))).toBe("completed")
    expect(map.get(mkId("B"))).toBe("completed")
  })

  it("already skipped tasks remain skipped", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "failed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "skipped" }),
    ]
    const updated = markFailedDependents(tasks, "A")
    const map = new Map(updated.map((t) => [t.id, t.status]))
    expect(map.get(mkId("A"))).toBe("failed")
    expect(map.get(mkId("B"))).toBe("skipped")
  })

  it("transitive dependents are also skipped", () => {
    const tasks = [
      task({ id: mkId("A"), depends_on: [], status: "failed" }),
      task({ id: mkId("B"), depends_on: ["A"], status: "pending" }),
      task({ id: mkId("C"), depends_on: ["B"], status: "pending" }),
      task({ id: mkId("D"), depends_on: ["C"], status: "pending" }),
    ]
    const updated = markFailedDependents(tasks, "A")
    const map = new Map(updated.map((t) => [t.id, t.status]))
    expect(map.get(mkId("A"))).toBe("failed")
    expect(map.get(mkId("B"))).toBe("skipped")
    expect(map.get(mkId("C"))).toBe("skipped")
    expect(map.get(mkId("D"))).toBe("skipped")
  })
})

// ---------------------------------------------------------------------------
// isPlanComplete
// ---------------------------------------------------------------------------

describe("isPlanComplete", () => {
  it("empty list is complete", () => {
    expect(isPlanComplete([])).toBe(true)
  })

  it("all tasks completed is complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "completed" }),
      task({ id: mkId("B"), status: "completed" }),
    ]
    expect(isPlanComplete(tasks)).toBe(true)
  })

  it("one task pending means plan is not complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "completed" }),
      task({ id: mkId("B"), status: "pending" }),
    ]
    expect(isPlanComplete(tasks)).toBe(false)
  })

  it("one failed, rest skipped means plan is complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "failed" }),
      task({ id: mkId("B"), status: "skipped" }),
      task({ id: mkId("C"), status: "skipped" }),
    ]
    expect(isPlanComplete(tasks)).toBe(true)
  })

  it("half done, half pending means plan is not complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "completed" }),
      task({ id: mkId("B"), status: "pending" }),
      task({ id: mkId("C"), status: "in_progress" }),
    ]
    expect(isPlanComplete(tasks)).toBe(false)
  })

  it("all skipped means plan is complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "skipped" }),
      task({ id: mkId("B"), status: "skipped" }),
    ]
    expect(isPlanComplete(tasks)).toBe(true)
  })

  it("mix of completed, failed, and skipped is complete", () => {
    const tasks = [
      task({ id: mkId("A"), status: "completed" }),
      task({ id: mkId("B"), status: "failed" }),
      task({ id: mkId("C"), status: "skipped" }),
    ]
    expect(isPlanComplete(tasks)).toBe(true)
  })
})
