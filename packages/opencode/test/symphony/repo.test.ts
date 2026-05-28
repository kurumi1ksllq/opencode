import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { SymphonyRepo } from "@/symphony/repo"
import { IssueID, WorkspaceID, PlanID, TaskID, SymphonyRepoError } from "@/symphony/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(SymphonyRepo.layer)

const uid = () => crypto.randomUUID()

describe("SymphonyRepo", () => {
  it.live("insertIssue and getIssue", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as IssueID

      const issue = yield* repo.insertIssue({
        id,
        repo_owner: "test-owner",
        repo_name: "test-repo",
        issue_number: 42,
        title: "Test Issue",
        body: "This is a test issue body",
        status: "pending",
        worktree_name: null,
        metadata: { source: "test", priority: 1 },
      })

      expect(issue.id).toBe(id)
      expect(issue.repo_owner).toBe("test-owner")
      expect(issue.repo_name).toBe("test-repo")
      expect(issue.issue_number).toBe(42)
      expect(issue.title).toBe("Test Issue")
      expect(issue.body).toBe("This is a test issue body")
      expect(issue.status).toBe("pending")
      expect(issue.worktree_name).toBeNull()
      expect(issue.metadata).toEqual({ source: "test", priority: 1 })
      expect(typeof issue.time_created).toBe("number")
      expect(typeof issue.time_updated).toBe("number")

      const retrieved = yield* repo.getIssue(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).title).toBe("Test Issue")
      expect(Option.getOrThrow(retrieved).body).toBe("This is a test issue body")

      yield* repo.deleteIssue(id)
    }),
  )

  it.live("insertIssue with duplicate ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as IssueID

      yield* repo.insertIssue({
        id,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "First",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      const error = yield* Effect.flip(
        repo.insertIssue({
          id,
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 2,
          title: "Duplicate",
          body: null,
          status: "pending",
          worktree_name: null,
          metadata: {},
        }),
      )

      expect(error).toBeInstanceOf(SymphonyRepoError)
      expect(error._tag).toBe("SymphonyRepoError")

      yield* repo.deleteIssue(id)
    }),
  )

  it.live("listIssues by status", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id1 = uid() as IssueID
      const id2 = uid() as IssueID

      yield* repo.insertIssue({
        id: id1,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Pending Issue",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertIssue({
        id: id2,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 2,
        title: "Completed Issue",
        body: null,
        status: "completed",
        worktree_name: null,
        metadata: {},
      })

      const pendingIssues = yield* repo.listIssues("pending")
      expect(pendingIssues.length).toBeGreaterThanOrEqual(1)
      expect(pendingIssues.some((i) => i.id === id1)).toBe(true)
      expect(pendingIssues.some((i) => i.id === id2)).toBe(false)

      const completedIssues = yield* repo.listIssues("completed")
      expect(completedIssues.some((i) => i.id === id1)).toBe(false)
      expect(completedIssues.some((i) => i.id === id2)).toBe(true)

      yield* repo.deleteIssue(id1)
      yield* repo.deleteIssue(id2)
    }),
  )

  it.live("updateIssueStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as IssueID

      yield* repo.insertIssue({
        id,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Updatable Issue",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.updateIssueStatus(id, "processing")

      const retrieved = yield* repo.getIssue(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("processing")

      yield* repo.deleteIssue(id)
    }),
  )

  it.live("updateIssueStatus with additional fields", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id = uid() as IssueID

      yield* repo.insertIssue({
        id,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Field Update",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: { initial: true },
      })

      yield* repo.updateIssueStatus(id, "completed", {
        worktree_name: "my-worktree",
        metadata: { updated: true },
      })

      const retrieved = yield* repo.getIssue(id)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("completed")
      expect(Option.getOrThrow(retrieved).worktree_name).toBe("my-worktree")
      expect(Option.getOrThrow(retrieved).metadata).toEqual({ updated: true })

      yield* repo.deleteIssue(id)
    }),
  )

  it.live("insertWorkspace and getWorkspaceByIssueId", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Workspace Test",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
        directory: "/tmp/test-workspace",
        branch: "feature/test",
        status: "creating",
      })

      const retrieved = yield* repo.getWorkspaceByIssueId(issueId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).id).toBe(workspaceId)
      expect(Option.getOrThrow(retrieved).issue_id).toBe(issueId)
      expect(Option.getOrThrow(retrieved).directory).toBe("/tmp/test-workspace")
      expect(Option.getOrThrow(retrieved).branch).toBe("feature/test")
      expect(Option.getOrThrow(retrieved).status).toBe("creating")
      expect(typeof Option.getOrThrow(retrieved).time_created).toBe("number")
      expect(typeof Option.getOrThrow(retrieved).time_updated).toBe("number")

      yield* repo.deleteIssue(issueId)
    }),
  )

  it.live("updateWorkspaceStatus", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Workspace Status",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
        directory: "/tmp/ws",
        branch: "main",
        status: "creating",
      })

      yield* repo.updateWorkspaceStatus(workspaceId, "ready")

      const retrieved = yield* repo.getWorkspaceByIssueId(issueId)
      expect(Option.isSome(retrieved)).toBe(true)
      expect(Option.getOrThrow(retrieved).status).toBe("ready")

      yield* repo.deleteIssue(issueId)
    }),
  )

  it.live("deleteIssue cascade", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Cascade Test",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
        directory: "/tmp/cascade",
        branch: "main",
        status: "ready",
      })

      yield* repo.deleteIssue(issueId)

      const issue = yield* repo.getIssue(issueId)
      expect(Option.isNone(issue)).toBe(true)

      const workspace = yield* repo.getWorkspaceByIssueId(issueId)
      expect(Option.isNone(workspace)).toBe(true)
    }),
  )

  it.live("listIssues without filter", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const id1 = uid() as IssueID
      const id2 = uid() as IssueID

      yield* repo.insertIssue({
        id: id1,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Issue A",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertIssue({
        id: id2,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 2,
        title: "Issue B",
        body: null,
        status: "completed",
        worktree_name: null,
        metadata: {},
      })

      const all = yield* repo.listIssues()
      expect(all.length).toBeGreaterThanOrEqual(2)
      const ids = all.map((i) => i.id)
      expect(ids).toContain(id1)
      expect(ids).toContain(id2)

      yield* repo.deleteIssue(id1)
      yield* repo.deleteIssue(id2)
    }),
  )

  it.live("getIssue returns None for missing ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getIssue(uid() as IssueID)
      expect(Option.isNone(missing)).toBe(true)
    }),
  )

  it.live("getWorkspaceByIssueId returns None for missing issue ID", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const missing = yield* repo.getWorkspaceByIssueId(uid() as IssueID)
      expect(Option.isNone(missing)).toBe(true)
    }),
  )

  // --- Plan tests ---

  it.live("insertPlan and getPlan", () =>
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Plan Test",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })

      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make("plan-dupe-test")

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Dupe Plan",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Plan Status",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Task Test",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "List Tasks",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
      const issueId = uid() as IssueID
      const workspaceId = uid() as WorkspaceID
      const planId = PlanID.make(uid())
      const taskId = TaskID.make(uid())

      yield* repo.insertIssue({
        id: issueId,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Task Update",
        body: null,
        status: "pending",
        worktree_name: null,
        metadata: {},
      })
      yield* repo.insertWorkspace({
        id: workspaceId,
        issue_id: issueId,
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
