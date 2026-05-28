import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Review } from "@/symphony/review"
import { SymphonyRepo } from "@/symphony/repo"
import { ReviewError, ReviewResult, TaskID, PlanID, JobID, WorkspaceID } from "@/symphony/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Review.layer.pipe(Layer.provideMerge(SymphonyRepo.layer)))

const uid = () => crypto.randomUUID()

const setupTask = (repo: SymphonyRepo.Interface, taskId: TaskID) =>
  Effect.gen(function* () {
    const jobId = uid() as JobID
    const workspaceId = uid() as WorkspaceID
    const planId = PlanID.make(uid())

    yield* repo.insertJob({
      id: jobId,
      source: "github",
      type: "issue",
      title: "Review Test Job",
      payload: { repo_owner: "test", repo_name: "test", issue_number: 1 },
      priority: 5,
      status: "pending",
      worktree_name: null,
    })
    yield* repo.insertWorkspace({
      id: workspaceId,
      job_id: jobId,
      directory: "/tmp/review-test",
      branch: "main",
      status: "ready",
    })
    yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Review test plan" })
    yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Review test task" })
  })

describe("Review", () => {
  it.live("review completed task with result passes", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const review = yield* Review.Service
      const taskId = TaskID.make(uid())

      yield* setupTask(repo, taskId)
      yield* repo.updateTaskStatus(taskId, "completed")
      yield* repo.updateTaskResult(taskId, "ok")

      const result = yield* review.reviewTask(taskId)
      expect(result).toBeInstanceOf(ReviewResult)
      expect(result.passed).toBe(true)
    }),
  )

  it.live("review completed task with empty result fails", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const review = yield* Review.Service
      const taskId = TaskID.make(uid())

      yield* setupTask(repo, taskId)
      yield* repo.updateTaskStatus(taskId, "completed")
      yield* repo.updateTaskResult(taskId, "")

      const result = yield* review.reviewTask(taskId)
      expect(result).toBeInstanceOf(ReviewResult)
      expect(result.passed).toBe(false)
      expect(result.feedback).toBe("No result produced")
    }),
  )

  it.live("review completed task with null result fails", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const review = yield* Review.Service
      const taskId = TaskID.make(uid())

      yield* setupTask(repo, taskId)
      yield* repo.updateTaskStatus(taskId, "completed")

      const result = yield* review.reviewTask(taskId)
      expect(result).toBeInstanceOf(ReviewResult)
      expect(result.passed).toBe(false)
      expect(result.feedback).toBe("No result produced")
    }),
  )

  it.live("review pending task fails with error", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const review = yield* Review.Service
      const taskId = TaskID.make(uid())

      yield* setupTask(repo, taskId)
      // status is "pending" by default

      const error = yield* Effect.flip(review.reviewTask(taskId))
      expect(error).toBeInstanceOf(ReviewError)
      expect(error.message).toContain("Can only review completed tasks")
    }),
  )

  it.live("review failed task fails with error", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const review = yield* Review.Service
      const taskId = TaskID.make(uid())

      yield* setupTask(repo, taskId)
      yield* repo.updateTaskStatus(taskId, "failed")

      const error = yield* Effect.flip(review.reviewTask(taskId))
      expect(error).toBeInstanceOf(ReviewError)
      expect(error.message).toContain("Can only review completed tasks")
    }),
  )

  it.live("review missing task fails with error", () =>
    Effect.gen(function* () {
      const review = yield* Review.Service
      const taskId = TaskID.make("nonexistent-task")

      const error = yield* Effect.flip(review.reviewTask(taskId))
      expect(error).toBeInstanceOf(ReviewError)
      expect(error.message).toContain("not found")
    }),
  )
})
