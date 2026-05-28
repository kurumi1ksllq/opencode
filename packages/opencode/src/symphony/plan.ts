import { TaskDef } from "./schema"

// ---------------------------------------------------------------------------
// Default ID generation when taskIds is not provided
// ---------------------------------------------------------------------------

function defaultTaskIds(count: number): string[] {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    if (i < 26) ids.push(String.fromCharCode(65 + i))
    else ids.push(String.fromCharCode(97 + i - 26))
  }
  return ids
}

// ---------------------------------------------------------------------------
// validateDag
// ---------------------------------------------------------------------------

/**
 * Detect cycles in a dependency graph using 3-colour DFS.
 *
 * @param dependsOnList - For each node (by index), the list of task IDs it depends on.
 * @param taskIds       - Optional names for each node. Generated as A, B, C… if omitted.
 * @returns `{ valid, cycles }` where `cycles` contains each cycle as
 *   `[start, ..., start]` (first element equals last).
 */
export function validateDag(
  dependsOnList: string[][],
  taskIds?: string[],
): { valid: boolean; cycles: string[][] } {
  const n = dependsOnList.length
  const ids = taskIds ?? defaultTaskIds(n)

  // Map from ID → array index
  const idToIndex = new Map<string, number>()
  ids.forEach((id, i) => idToIndex.set(id, i))

  // Adjacency list: edges from u → v means u depends on v (v must run first)
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (const depId of dependsOnList[i]) {
      const depIdx = idToIndex.get(depId)
      if (depIdx !== undefined) {
        adj[i].push(depIdx)
      }
      // External references (not in the graph) are ignored for cycle detection
    }
  }

  // 3-colour DFS: 0 = white (unvisited), 1 = gray (in current DFS path),
  // 2 = black (fully explored)
  const color = new Array<number>(n).fill(0)
  const parent = new Array<number>(n).fill(-1)
  const cycles: string[][] = []

  function dfs(u: number): void {
    color[u] = 1 // gray – on the current DFS path

    for (const v of adj[u]) {
      if (color[v] === 1) {
        // Back edge: v → … → u → v is a cycle
        const nodePath: number[] = []
        let cur = u
        while (cur !== v) {
          nodePath.push(cur)
          cur = parent[cur]
        }
        nodePath.reverse()
        cycles.push([ids[v], ...nodePath.map((i) => ids[i]), ids[v]])
      } else if (color[v] === 0) {
        parent[v] = u
        dfs(v)
      }
    }

    color[u] = 2 // black – fully explored
  }

  for (let i = 0; i < n; i++) {
    if (color[i] === 0) {
      dfs(i)
    }
  }

  return { valid: cycles.length === 0, cycles }
}

// ---------------------------------------------------------------------------
// topologicalSort (Kahn's algorithm)
// ---------------------------------------------------------------------------

/**
 * Return tasks in topological order (dependencies first).
 * Returns an empty array if a cycle is detected.
 */
export function topologicalSort(tasks: TaskDef[]): TaskDef[] {
  if (tasks.length === 0) return []

  const taskMap = new Map<string, TaskDef>(tasks.map((t) => [t.id, t]))

  // Reverse adjacency: for each task, which tasks depend on it?
  const dependents = new Map<string, string[]>()
  for (const t of tasks) {
    dependents.set(t.id, [])
  }
  for (const t of tasks) {
    for (const depId of t.depends_on) {
      if (taskMap.has(depId)) {
        dependents.get(depId)!.push(t.id)
      }
    }
  }

  // In-degree = number of unresolved dependencies
  const inDegree = new Map<string, number>()
  for (const t of tasks) {
    const deps = t.depends_on.filter((d) => taskMap.has(d))
    inDegree.set(t.id, deps.length)
  }

  // Start with tasks that have no unresolved deps
  const queue: string[] = []
  for (const t of tasks) {
    if (inDegree.get(t.id) === 0) {
      queue.push(t.id)
    }
  }

  const result: TaskDef[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(taskMap.get(id)!)

    for (const depId of dependents.get(id)!) {
      const deg = inDegree.get(depId)! - 1
      inDegree.set(depId, deg)
      if (deg === 0) {
        queue.push(depId)
      }
    }
  }

  // If not all tasks were processed, there is a cycle
  if (result.length !== tasks.length) return []

  return result
}

// ---------------------------------------------------------------------------
// getReadyTasks
// ---------------------------------------------------------------------------

/**
 * Find tasks whose dependencies are all completed and that are still pending —
 * i.e., tasks that can be started right now.
 */
export function getReadyTasks(tasks: TaskDef[]): TaskDef[] {
  const statusMap = new Map<string, TaskDef["status"]>(tasks.map((t) => [t.id, t.status]))

  return tasks.filter((t) => {
    // Only tasks still in "pending" state can become ready
    if (t.status !== "pending") return false
    // All dependencies must be "completed"
    return t.depends_on.every((depId) => statusMap.get(depId) === "completed")
  })
}

// ---------------------------------------------------------------------------
// markFailedDependents
// ---------------------------------------------------------------------------

/**
 * When a task fails, mark all tasks that (transitively) depend on it as
 * "skipped". Returns a new array with updated tasks; the original is not
 * mutated.
 */
export function markFailedDependents(
  tasks: TaskDef[],
  failedId: string,
): TaskDef[] {
  // Only propagate when the task actually failed
  const failedTask = tasks.find((t) => t.id === failedId)
  if (!failedTask || failedTask.status !== "failed") return tasks

  // Build reverse adjacency: task ID → list of IDs that depend on it
  const dependents = new Map<string, string[]>()
  for (const t of tasks) {
    dependents.set(t.id, [])
  }
  for (const t of tasks) {
    for (const depId of t.depends_on) {
      if (dependents.has(depId)) {
        dependents.get(depId)!.push(t.id)
      }
    }
  }

  // BFS from failedId through reverse adjacency
  const toSkip = new Set<string>()
  const queue = [failedId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const depId of dependents.get(id) ?? []) {
      if (!toSkip.has(depId)) {
        toSkip.add(depId)
        queue.push(depId)
      }
    }
  }

  return tasks.map((t) => {
    if (toSkip.has(t.id)) {
      return new TaskDef({ ...t, status: "skipped" })
    }
    return t
  })
}

// ---------------------------------------------------------------------------
// isPlanComplete
// ---------------------------------------------------------------------------

/**
 * A plan is complete when every task has reached a terminal status:
 * "completed", "failed", or "skipped".
 */
export function isPlanComplete(tasks: TaskDef[]): boolean {
  return tasks.every((t) =>
    t.status === "completed" || t.status === "failed" || t.status === "skipped"
  )
}

export * as Plan from "./plan"
