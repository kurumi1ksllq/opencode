import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Review } from "@/symphony/review"
import { SymphonyRepo } from "@/symphony/repo"
import { ReviewError, ReviewResult, TaskID, PlanID, IssueID, WorkspaceID } from "@/symphony/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Review.layer.pipe(Layer.provideMerge(SymphonyRepo.layer)))

const uid = () => crypto.randomUUID()

const setupTask = (repo: SymphonyRepo.Interface, taskId: TaskID) =>
  Effect.gen(function* () {
    const issueId = uid() as IssueID
    const workspaceId = uid() as WorkspaceID
    const planId = PlanID.make(uid())

    yield* repo.insertIssue({
      id: issueId,
      repo_owner: "owner",
      repo_name: "repo",
      issue_number: 1,
      title: "Review Test Issue",
      body: null,
      status: "pending",
      worktree_name: null,
      metadata: {},
    })
    yield* repo.insertWorkspace({
      id: workspaceId,
      issue_id: issueId,
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
