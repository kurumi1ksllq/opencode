import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { SymphonyRepo } from "@/symphony/repo"
import { Worker } from "@/symphony/worker"
import { PlanID, TaskID, IssueID, WorkspaceID, WorkerError } from "@/symphony/schema"
import type { TaskDefRow } from "@/symphony/repo"
import { testEffect } from "../lib/effect"
import { Database } from "@/storage/db"

const uid = () => crypto.randomUUID()

// Truncate symphony tables before each test
const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run("DELETE FROM symphony_taskdef")
    db.run("DELETE FROM symphony_plan")
    db.run("DELETE FROM symphony_workspace")
    db.run("DELETE FROM symphony_issue")
  }),
)

// Mock executor — behaviour is controlled per test via a mutable variable
let mockExecute: (task: TaskDefRow) => Effect.Effect<string, WorkerError>

const mockExecutorLayer = Layer.mock(Worker.TaskExecutor)({
  execute: (task) => mockExecute(task),
})

Database.Client()

const it = testEffect(
  Layer.mergeAll(
    Worker.layer.pipe(
      Layer.provide(mockExecutorLayer),
      Layer.provide(SymphonyRepo.layer),
    ),
    SymphonyRepo.layer,
    truncate,
  ),
)

// ---------------------------------------------------------------------------
// Inline setup helpers
// ---------------------------------------------------------------------------

function insertBaseEntities(issueId: IssueID, workspaceId: WorkspaceID, planId: PlanID) {
  return Effect.gen(function* () {
    const repo = yield* SymphonyRepo.Service
    yield* repo.insertIssue({
      id: issueId,
      repo_owner: "test",
      repo_name: "test",
      issue_number: 1,
      title: "Test Issue",
      body: null,
      status: "pending",
      worktree_name: null,
      metadata: {},
    })
    yield* repo.insertWorkspace({
      id: workspaceId,
      issue_id: issueId,
      directory: "/tmp/test-ws",
      branch: "main",
      status: "ready",
    })
    yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Test plan" })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SymphonyWorker", () => {
  it.live("1. Execute pending task successfully", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.succeed("all good")
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Test Task" })
      yield* worker.executeTask(taskId)

      const taskOpt = yield* repo.getTask(taskId)
      const task = Option.getOrThrow(taskOpt)
      expect(task.status).toBe("completed")
      expect(task.result).toBe("all good")
    }),
  )

  it.live("2. Execute ready task successfully", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.succeed("ready task done")
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Ready Task" })
      yield* repo.updateTaskStatus(taskId, "ready")
      yield* worker.executeTask(taskId)

      const taskOpt = yield* repo.getTask(taskId)
      const task = Option.getOrThrow(taskOpt)
      expect(task.status).toBe("completed")
      expect(task.result).toBe("ready task done")
    }),
  )

  it.live("3. Execute completed task fails", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.succeed("should not run")
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Already Done" })
      yield* repo.updateTaskStatus(taskId, "completed")

      const error = yield* Effect.flip(worker.executeTask(taskId))
      expect(error).toBeInstanceOf(WorkerError)
      expect(error.message).toContain("status is completed")
    }),
  )

  it.live("4. Executor failure → task marked failed", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.fail(new WorkerError({ message: "boom" }))
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Failing Task" })
      yield* worker.executeTask(taskId)

      const taskOpt = yield* repo.getTask(taskId)
      const task = Option.getOrThrow(taskOpt)
      expect(task.status).toBe("failed")
      expect(task.result).toBe("boom")
    }),
  )

  it.live("5. Failed task marks dependents skipped", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.fail(new WorkerError({ message: "fail A" }))
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskIdA = TaskID.make(uid())
      const taskIdB = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskIdA, plan_id: planId, title: "Task A" })
      yield* repo.insertTask({
        id: taskIdB,
        plan_id: planId,
        title: "Task B",
        depends_on: [taskIdA],
      })

      yield* worker.executeTask(taskIdA)

      const taskAOpt = yield* repo.getTask(taskIdA)
      expect(Option.getOrThrow(taskAOpt).status).toBe("failed")

      const tasks = yield* repo.listTasksByPlan(planId)
      const taskB = tasks.find((t) => t.id === taskIdB)
      expect(taskB!.status).toBe("skipped")
    }),
  )

  it.live("6. Last task completes → plan completed", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.succeed("done")
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Only Task" })
      yield* worker.executeTask(taskId)

      const planOpt = yield* repo.getPlan(planId)
      expect(Option.getOrThrow(planOpt).status).toBe("completed")
    }),
  )

  it.live("7. Missing task ID fails", () =>
    Effect.gen(function* () {
      mockExecute = () => Effect.succeed("noop")
      const worker = yield* Worker.Service
      const error = yield* Effect.flip(worker.executeTask(TaskID.make("nonexistent")))

      expect(error).toBeInstanceOf(WorkerError)
      expect(error.message).toContain("not found")
    }),
  )

  it.live("8. Executor can return different results", () =>
    Effect.gen(function* () {
      const worker = yield* Worker.Service
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* insertBaseEntities(issueId, workspaceId, planId)
      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Return-title" })

      mockExecute = (task) => Effect.succeed(task.title)
      yield* worker.executeTask(taskId)

      const taskOpt = yield* repo.getTask(taskId)
      const task = Option.getOrThrow(taskOpt)
      expect(task.status).toBe("completed")
      expect(task.result).toBe("Return-title")
    }),
  )
})
