import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { SymphonyRepo } from "@/symphony/repo"
import { JobID, WorkspaceID, PlanID, TaskID, SymphonyRepoError } from "@/symphony/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(SymphonyRepo.layer)

const uid = () => crypto.randomUUID()

describe("SymphonyRepo", () => {
  it.live("insertJob and getJob", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as JobID

      const job = yield* repo.insertJob({
        id,
        source: "github",
        type: "issue",
        title: "Test Issue",
        payload: { repo_owner: "test-owner", repo_name: "test-repo", issue_number: 42, body: "This is a test issue body", metadata: { source: "test", priority: 1 } },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      expect(job.id).toBe(id)
      expect(job.payload).toEqual(expect.objectContaining({ repo_owner: "test-owner", repo_name: "test-repo", issue_number: 42, body: "This is a test issue body", metadata: { source: "test", priority: 1 } }))
      expect(job.title).toBe("Test Issue")
      expect(job.status).toBe("pending")
      expect(job.worktree_name).toBeNull()
      expect(typeof job.time_created).toBe("number")
      expect(typeof job.time_updated).toBe("number")

      const retrieved = yield* repo.getJob(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).title).toBe("Test Issue")
      expect(Option.getOrThrow(retrieved).payload).toEqual(expect.objectContaining({ body: "This is a test issue body" }))

      yield* repo.deleteJob(id)
    }),
  )

  it.live("insertJob with duplicate ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as JobID

      yield* repo.insertJob({
        id,
        source: "github",
        type: "issue",
        title: "First",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      const error = yield* Effect.flip(
        repo.insertJob({
          id,
          source: "github",
          type: "issue",
          title: "Duplicate",
          payload: { repo_owner: "owner", repo_name: "repo", issue_number: 2, body: null },
          priority: 5,
          status: "pending",
          worktree_name: null,
        }),
      )

      expect(error).toBeInstanceOf(SymphonyRepoError)
      expect(error._tag).toBe("SymphonyRepoError")

      yield* repo.deleteJob(id)
    }),
  )

  it.live("listJobs by status", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id1 = uid() as JobID
      const id2 = uid() as JobID

      yield* repo.insertJob({
        id: id1,
        source: "github",
        type: "issue",
        title: "Pending Issue",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertJob({
        id: id2,
        source: "github",
        type: "issue",
        title: "Completed Issue",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 2, body: null },
        priority: 5,
        status: "completed",
        worktree_name: null,
      })

      const pendingJobs = yield* repo.listJobs("pending")
      expect(pendingJobs.length).toBeGreaterThanOrEqual(1)
      expect(pendingJobs.some((i) => i.id === id1)).toBe(true)
      expect(pendingJobs.some((i) => i.id === id2)).toBe(false)

      const completedJobs = yield* repo.listJobs("completed")
      expect(completedJobs.some((i) => i.id === id1)).toBe(false)
      expect(completedJobs.some((i) => i.id === id2)).toBe(true)

      yield* repo.deleteJob(id1)
      yield* repo.deleteJob(id2)
    }),
  )

  it.live("updateJobStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as JobID

      yield* repo.insertJob({
        id,
        source: "github",
        type: "issue",
        title: "Updatable Job",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.updateJobStatus(id, "processing")

      const retrieved = yield* repo.getJob(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("processing")

      yield* repo.deleteJob(id)
    }),
  )

  it.live("updateJobStatus with additional fields", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as JobID

      yield* repo.insertJob({
        id,
        source: "github",
        type: "issue",
        title: "Field Update",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, initial: true },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.updateJobStatus(id, "completed", {
        worktree_name: "my-worktree",
        payload: { updated: true },
      })

      const retrieved = yield* repo.getJob(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("completed")
      expect(Option.getOrThrow(retrieved).worktree_name).toBe("my-worktree")
      expect(Option.getOrThrow(retrieved).payload).toEqual(expect.objectContaining({ updated: true }))

      yield* repo.deleteJob(id)
    }),
  )

  it.live("insertWorkspace and getWorkspaceByJobId", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const jobId = uid() as JobID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertJob({
        id: jobId,
        source: "github",
        type: "issue",
        title: "Workspace Test",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: jobId,
        directory: "/tmp/test-workspace",
        branch: "feature/test",
        status: "creating",
      })

      const retrieved = yield* repo.getWorkspaceByJobId(jobId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).id).toBe(workspaceId)
      expect(Option.getOrThrow(retrieved).job_id).toBe(jobId)
      expect(Option.getOrThrow(retrieved).directory).toBe("/tmp/test-workspace")
      expect(Option.getOrThrow(retrieved).branch).toBe("feature/test")
      expect(Option.getOrThrow(retrieved).status).toBe("creating")
      expect(typeof Option.getOrThrow(retrieved).time_created).toBe("number")
      expect(typeof Option.getOrThrow(retrieved).time_updated).toBe("number")

      yield* repo.deleteJob(jobId)
    }),
  )

  it.live("updateWorkspaceStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const jobId = uid() as JobID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertJob({
        id: jobId,
        source: "github",
        type: "issue",
        title: "Workspace Status",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: jobId,
        directory: "/tmp/ws",
        branch: "main",
        status: "creating",
      })

      yield* repo.updateWorkspaceStatus(workspaceId, "ready")

      const retrieved = yield* repo.getWorkspaceByJobId(jobId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("ready")

      yield* repo.deleteJob(jobId)
    }),
  )

  it.live("deleteJob cascade", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const jobId = uid() as JobID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertJob({
        id: jobId,
        source: "github",
        type: "issue",
        title: "Cascade Test",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: jobId,
        directory: "/tmp/cascade",
        branch: "main",
        status: "ready",
      })

      yield* repo.deleteJob(jobId)

      const job = yield* repo.getJob(jobId)
      expect(Option.isNone(job)).toBe(true)

      const workspace = yield* repo.getWorkspaceByJobId(jobId)
      expect(Option.isNone(workspace)).toBe(true)
    }),
  )

  it.live("listJobs without filter", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id1 = uid() as JobID
      const id2 = uid() as JobID

      yield* repo.insertJob({
        id: id1,
        source: "github",
        type: "issue",
        title: "Job A",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertJob({
        id: id2,
        source: "github",
        type: "issue",
        title: "Job B",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 2, body: null },
        priority: 5,
        status: "completed",
        worktree_name: null,
      })

      const all = yield* repo.listJobs()
      expect(all.length).toBeGreaterThanOrEqual(2)
      const ids = all.map((i) => i.id)
      expect(ids).toContain(id1)
      expect(ids).toContain(id2)

      yield* repo.deleteJob(id1)
      yield* repo.deleteJob(id2)
    }),
  )

  it.live("getJob returns None for missing ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getJob(uid() as JobID)
      expect(Option.isNone(missing)).toBe(true)
    }),
  )

  it.live("getWorkspaceByJobId returns None for missing job ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getWorkspaceByJobId(uid() as JobID)
      expect(Option.isNone(missing)).toBe(true)
    }),
  )

  // --- Plan tests ---

  it.live("insertPlan and getPlan", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "Plan Test",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/plan-test",
        branch: "main",
        status: "ready",
      })

      const plan = yield* repo.insertPlan({
        id: planId,
        workspace_id: workspaceId,
        goal: "Implement feature X",
      })

      expect(plan.id).toBe(planId)
      expect(plan.workspace_id).toBe(workspaceId)
      expect(plan.goal).toBe("Implement feature X")
      expect(plan.status).toBe("draft")
      expect(typeof plan.time_created).toBe("number")
      expect(typeof plan.time_updated).toBe("number")

      const retrieved = yield* repo.getPlan(planId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).goal).toBe("Implement feature X")
      expect(Option.getOrThrow(retrieved).status).toBe("draft")
    }),
  )

  it.live("insertPlan with duplicate ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make("plan-dupe-test")

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "Dupe Plan",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/plan-dupe",
        branch: "main",
        status: "ready",
      })
      yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "First" })

      const error = yield* Effect.flip(
        repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Duplicate" }),
      )
      expect(error).toBeInstanceOf(SymphonyRepoError)
      expect(error._tag).toBe("SymphonyRepoError")
    }),
  )

  it.live("updatePlanStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "Plan Status",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/plan-status",
        branch: "main",
        status: "ready",
      })
      yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Status test" })

      yield* repo.updatePlanStatus(planId, "active")

      const retrieved = yield* repo.getPlan(planId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("active")
    }),
  )

  it.live("getPlan returns None for missing ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getPlan(PlanID.make("nonexistent-plan"))
      expect(Option.isNone(missing)).toBe(true)
    }),
  )

  // --- TaskDef tests ---

  it.live("insertTask and getTask with JSON arrays", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "Task Test",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/task-test",
        branch: "main",
        status: "ready",
      })
      yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Task plan" })

      const criteria = ["Must handle errors", "Must be fast"]
      const deps = ["task-prep", "task-setup"]

      const task = yield* repo.insertTask({
        id: taskId,
        plan_id: planId,
        title: "Implement X",
        description: "Do the thing",
        acceptance_criteria: criteria,
        depends_on: deps,
        prompt_template: "Write code for {{feature}}",
      })

      expect(task.id).toBe(taskId)
      expect(task.plan_id).toBe(planId)
      expect(task.title).toBe("Implement X")
      expect(task.description).toBe("Do the thing")
      expect(task.prompt_template).toBe("Write code for {{feature}}")
      expect(task.status).toBe("pending")
      // acceptance_criteria and depends_on stored as JSON strings in SQLite
      expect(JSON.parse(task.acceptance_criteria)).toEqual(criteria)
      expect(JSON.parse(task.depends_on)).toEqual(deps)
      expect(typeof task.time_created).toBe("number")
      expect(typeof task.time_updated).toBe("number")

      const retrieved = yield* repo.getTask(taskId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).title).toBe("Implement X")
      expect(Option.getOrThrow(retrieved).status).toBe("pending")
    }),
  )

  it.live("listTasksByPlan", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "List Tasks",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/list-tasks",
        branch: "main",
        status: "ready",
      })
      yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "List plan" })

      yield* repo.insertTask({ id: TaskID.make(uid()), plan_id: planId, title: "Task A" })
      yield* repo.insertTask({ id: TaskID.make(uid()), plan_id: planId, title: "Task B" })
      yield* repo.insertTask({ id: TaskID.make(uid()), plan_id: planId, title: "Task C" })

      const tasks = yield* repo.listTasksByPlan(planId)
      expect(tasks.length).toBe(3)
      const titles = tasks.map((t) => t.title).sort()
      expect(titles).toEqual(["Task A", "Task B", "Task C"])
    }),
  )

  it.live("updateTaskStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as JobID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* repo.insertJob({
        id: issueId,
        source: "github",
        type: "issue",
        title: "Task Update",
        payload: { repo_owner: "owner", repo_name: "repo", issue_number: 1, body: null, metadata: {} },
        priority: 5,
        status: "pending",
        worktree_name: null,
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        job_id: issueId,
        directory: "/tmp/update-task",
        branch: "main",
        status: "ready",
      })
      yield* repo.insertPlan({ id: planId, workspace_id: workspaceId, goal: "Update plan" })

      yield* repo.insertTask({ id: taskId, plan_id: planId, title: "Updatable Task" })

      yield* repo.updateTaskStatus(taskId, "completed")

      const retrieved = yield* repo.getTask(taskId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("completed")
    }),
  )

  it.live("getTask returns None for missing ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getTask(TaskID.make("nonexistent-task"))
      expect(Option.isNone(missing)).toBe(true)
    }),
  )
})
