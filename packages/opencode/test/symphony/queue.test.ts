import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Symphony } from "@/symphony/symphony"
import { SymphonyRepo } from "@/symphony/repo"
import { Worktree } from "@/worktree"
import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { JobID } from "@/symphony/schema"
import { Worker } from "@/symphony/worker"
import { testEffect } from "../lib/effect"

const uid = () => crypto.randomUUID()

// Truncate tables before each test
const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run(`DELETE FROM symphony_workspace`)
    db.run(`DELETE FROM symphony_job`)
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

// Mock Worker — executeTask succeeds silently
const mockWorkerLayer = Layer.mock(Worker.Service)({
  executeTask: () => Effect.void,
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
      Layer.provide(mockWorkerLayer),
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
      const { job } = yield* symphony.enqueue({
        source: "github",
        type: "issue",
        title: "Test Issue",
        payload: {
          repo_owner: "test-owner",
          repo_name: "test-repo",
          issue_number: 42,
          body: "Test body",
        },
        priority: 5,
      })

      // Verify DB persistence
      const all = yield* repo.listJobs()
      expect(all.some((i) => i.id === job.id)).toBe(true)

      expect(job.status).toBe("queued")
      expect(job.payload.repo_owner).toBe("test-owner")
      expect(job.payload.repo_name).toBe("test-repo")
      expect(job.payload.issue_number).toBe(42)
      expect(job.title).toBe("Test Issue")
      expect(job.payload.body).toBe("Test body")
      expect(job.source).toBe("github")
    }),
  )

  it.live("enqueue creates issue without optional fields", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const { job } = yield* symphony.enqueue({
        source: "github",
        type: "issue",
        title: "Minimal",
        payload: {
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 1,
        },
        priority: 5,
      })

      expect(job.status).toBe("queued")
      expect(job.payload.body).toBeUndefined()
    }),
  )

  it.live("processNext transitions queued issue to processing", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.enqueue({
        source: "github",
        type: "issue",
        title: "Process Me",
        payload: {
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 1,
        },
        priority: 5,
      })

      yield* symphony.processNext()

      const all = yield* repo.listJobs()
      expect(all.length).toBe(1)
      expect(all[0].status).toBe("processing")
    }),
  )

  it.live("processNext creates a workspace record", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.enqueue({
        source: "github",
        type: "issue",
        title: "Workspace Test",
        payload: {
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 1,
        },
        priority: 5,
      })

      yield* symphony.processNext()

      const all = yield* repo.listJobs()
      expect(all.length).toBe(1)

      const ws = yield* repo.getWorkspaceByJobId(all[0].id as JobID)
      expect(Option.isSome(ws)).toBe(true)
      if (Option.isSome(ws)) {
        expect(ws.value.job_id).toBe(all[0].id)
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

      const id = uid() as JobID
      yield* repo.insertJob({
        id,
        source: "github",
        type: "issue",
        title: "Already Done",
        payload: {
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 1,
        },
        priority: 5,
        status: "completed",
        worktree_name: null,
      })

      yield* symphony.processNext()

      const all = yield* repo.listJobs()
      expect(all.length).toBe(1)
      expect(all[0].status).toBe("completed")
    }),
  )
})
