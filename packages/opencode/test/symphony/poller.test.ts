import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Symphony } from "@/symphony/symphony"
import { SymphonyRepo } from "@/symphony/repo"
import { Worktree } from "@/worktree"
import { Config } from "@/config/config"
import { Database } from "@/storage/db"
import { ReviewResult } from "@/symphony/schema"
import { Review } from "@/symphony/review"
import { Worker } from "@/symphony/worker"
import { testEffect } from "../lib/effect"

// Fake GitHub issues matching the GitHubIssue Schema
const fakeIssues = [
  {
    id: 1,
    number: 100,
    title: "Fix login bug",
    body: "Users cannot log in",
    html_url: "https://github.com/owner/repo/issues/100",
    state: "open",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
    labels: [{ name: "bug" }],
    user: { login: "testuser" },
  },
  {
    id: 2,
    number: 101,
    title: "Add feature X",
    body: null,
    html_url: "https://github.com/owner/repo/issues/101",
    state: "open",
    created_at: "2025-01-03T00:00:00Z",
    updated_at: "2025-01-04T00:00:00Z",
    labels: [],
    user: null,
  },
]

// Mock HTTP returning fake GitHub issues
const mockHttpLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        {} as any,
        new Response(JSON.stringify(fakeIssues), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  ),
)

// Mock Worktree — no methods needed for poller tests
const mockWorktreeLayer = Layer.mock(Worktree.Service)({})

// Mock Worker — no methods needed for poller tests
const mockWorkerLayer = Layer.mock(Worker.Service)({})

// Mock Review
const mockReviewLayer = Layer.succeed(
  Review.Service,
  Review.Service.of({
    reviewTask: () => Effect.succeed(new ReviewResult({ passed: true })),
  }),
)

// Truncate tables before each test
const truncate = Layer.effectDiscard(
  Effect.sync(() => {
    const db = Database.Client()
    db.run("DELETE FROM symphony_workspace")
    db.run("DELETE FROM symphony_job")
  }),
)

// Initialize DB once
Database.Client()

// Config with polling enabled and one repo
const configWithPolling = Layer.mock(Config.Service)({
  get: () =>
    Effect.succeed({
      symphony: {
        enabled: true,
        github: {
          polling_interval_seconds: 86400,
          repos: ["owner/repo"],
        },
      },
    } as any),
})

const makeTestLayer = (configLayer: Layer.Layer<Config.Service>) =>
  Layer.mergeAll(
    Symphony.layer.pipe(
      Layer.provide(SymphonyRepo.layer),
      Layer.provide(mockWorktreeLayer),
      Layer.provide(configLayer),
      Layer.provide(mockHttpLayer),
      Layer.provide(mockReviewLayer),
      Layer.provide(mockWorkerLayer),
    ),
    SymphonyRepo.layer,
    truncate,
  )

const it = testEffect(makeTestLayer(configWithPolling))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Symphony poller", () => {
  it.live("T1: new issues are enqueued as jobs", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.pollIssues()

      const jobs = yield* repo.listJobs()
      expect(jobs.length).toBe(2)

      const job100 = jobs.find((j) => (j.payload as Record<string, unknown>).issue_number === 100)!
      expect(job100.source).toBe("github")
      expect(job100.type).toBe("issue")
      expect(job100.title).toBe("Fix login bug")
      expect((job100.payload as Record<string, unknown>).repo_owner).toBe("owner")
      expect((job100.payload as Record<string, unknown>).repo_name).toBe("repo")
      expect((job100.payload as Record<string, unknown>).body).toBe("Users cannot log in")
      expect((job100.payload as Record<string, unknown>).html_url).toBe("https://github.com/owner/repo/issues/100")
      expect((job100.payload as Record<string, unknown>).github_id).toBe(1)
      expect((job100.payload as Record<string, unknown>).labels).toEqual(["bug"])
      expect((job100.payload as Record<string, unknown>).user).toBe("testuser")

      const job101 = jobs.find((j) => (j.payload as Record<string, unknown>).issue_number === 101)!
      expect(job101.title).toBe("Add feature X")
      expect((job101.payload as Record<string, unknown>).body).toBeUndefined()
    }),
  )

  it.live("T2: same issues are not duplicated on re-poll", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      yield* symphony.pollIssues()
      yield* symphony.pollIssues()

      const jobs = yield* repo.listJobs()
      expect(jobs.length).toBe(2)
    }),
  )

  it.live("T3: already-existing issue is skipped during poll", () =>
    Effect.gen(function* () {
      const symphony = yield* Symphony.Service
      const repo = yield* SymphonyRepo.Service

      // Insert one job manually to simulate already-processed issue #100
      const id = crypto.randomUUID()
      yield* repo.insertJob({
        id: id as any,
        source: "github",
        type: "issue",
        title: "Existing Issue",
        payload: {
          repo_owner: "owner",
          repo_name: "repo",
          issue_number: 100,
        },
        priority: 5,
        status: "queued",
        worktree_name: null,
      })

      yield* symphony.pollIssues()

      const jobs = yield* repo.listJobs()
      // 1 existing (issue 100) + 1 new (issue 101) = 2 total
      expect(jobs.length).toBe(2)
    }),
  )
})
