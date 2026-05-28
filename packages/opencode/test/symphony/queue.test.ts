import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Symphony } from "@/symphony/symphony"
import { SymphonyRepo } from "@/symphony/repo"
import { Worktree } from "@/worktree"
import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { IssueID } from "@/symphony/schema"
import { testEffect } from "../lib/effect"

const uid = () => crypto.randomUUID()

// Truncate tables before each test
const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run(`DELETE FROM symphony_workspace`)
    db.run(`DELETE FROM symphony_issue`)
  }),
)

// Mock Worktree — only methods called by the tests need implementations
const mockWorktreeLayer = Layer.mock(Worktree.Service)({
  makeWorktreeInfo: () =>
    Effect.succeed({
      name: "test-worktree",
      branch: "feature/test",
      directory: "/tmp/test-symphony-worktree",
    }),
  createFromInfo: () => Effect.void,
})

// Minimal mocks for services the Symphony layer requires but the tests don't exercise
const mockConfigLayer = Layer.mock(Config.Service)({})
const mockHttpLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))),
  ),
)

// Initialize DB once
Database.Client()

const it = testEffect(
  Layer.mergeAll(
    Symphony.layer.pipe(
      Layer.provide(SymphonyRepo.layer),
      Layer.provide(mockWorktreeLayer),
      Layer.provide(mockConfigLayer),
      Layer.provide(mockHttpLayer),
    ),
    SymphonyRepo.layer,
    truncate,
  ),
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Symphony queue", () => {
  it.live("enqueue creates an issue with queued status", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service
      const { issue } = yield* symphony.enqueue({
        repo_owner: "test-owner",
        repo_name: "test-repo",
        issue_number: 42,
        title: "Test Issue",
        body: "Test body",
        metadata: { source: "test" },
      })

      // Verify DB persistence
      const all = yield* repo.listIssues()
      expect(all.some((i) => i.id === issue.id)).toBe(true)

      expect(issue.status).toBe("queued")
      expect(issue.repo_owner).toBe("test-owner")
      expect(issue.repo_name).toBe("test-repo")
      expect(issue.issue_number).toBe(42)
      expect(issue.title).toBe("Test Issue")
      expect(issue.body).toBe("Test body")
      expect(issue.metadata).toEqual({ source: "test" })
    }),
  )

  it.live("enqueue creates issue without optional fields", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const { issue } = yield* symphony.enqueue({
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Minimal",
      })

      expect(issue.status).toBe("queued")
      expect(issue.body).toBeNull()
      expect(issue.metadata).toEqual({})
    }),
  )

  it.live("processNext transitions queued issue to processing", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.enqueue({
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Process Me",
      })

      yield* symphony.processNext()

      const all = yield* repo.listIssues()
      expect(all.length).toBe(1)
      expect(all[0].status).toBe("processing")
    }),
  )

  it.live("processNext creates a workspace record", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.enqueue({
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Workspace Test",
      })

      yield* symphony.processNext()

      const all = yield* repo.listIssues()
      expect(all.length).toBe(1)

      const ws = yield* repo.getWorkspaceByIssueId(all[0].id as IssueID)
      expect(Option.isSome(ws)).toBe(true)
      if (Option.isSome(ws)) {
        expect(ws.value.issue_id).toBe(all[0].id)
        expect(ws.value.status).toBe("ready")
        expect(ws.value.directory).toBe("/tmp/test-symphony-worktree")
        expect(ws.value.branch).toBe("feature/test")
      }
    }),
  )

  it.live("processNext with empty queue does nothing", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      yield* symphony.processNext()
    }),
  )

  it.live("processNext ignores completed issues", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      const id = uid() as IssueID
      yield* repo.insertIssue({
        id,
        repo_owner: "owner",
        repo_name: "repo",
        issue_number: 1,
        title: "Already Done",
        body: null,
        status: "completed",
        worktree_name: null,
        metadata: {},
      })

      yield* symphony.processNext()

      const all = yield* repo.listIssues()
      expect(all.length).toBe(1)
      expect(all[0].status).toBe("completed")
    }),
  )
})
