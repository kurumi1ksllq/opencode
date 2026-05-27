import { Context, Duration, Effect, Fiber, Layer, Option, Schedule, Scope } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"

import { Config } from "@/config/config"
import { ConfigSymphony } from "./config/symphony"
import { Issue, IssueID, IssueStatus, QueueError, Workspace, WorkspaceID, WorkspaceStatus } from "./schema"
import { SymphonyRepo } from "./repo"

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  readonly enqueue: (input: {
    repo_owner: string
    repo_name: string
    issue_number: number
    title: string
    body?: string
    metadata?: Record<string, unknown>
  }) => Effect.Effect<{ issue: Issue; workspace?: Workspace }, QueueError>
  readonly processNext: () => Effect.Effect<void, QueueError>
  readonly startPolling: () => Effect.Effect<void>
  readonly stopPolling: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Symphony") {}

const isValidTransition = (from: IssueStatus, to: IssueStatus): boolean => {
  const transitions: Record<IssueStatus, readonly IssueStatus[]> = {
    pending: ["queued"],
    queued: ["processing"],
    processing: ["completed", "failed"],
    completed: [],
    failed: [],
  }
  return transitions[from]?.includes(to) ?? false
}

export const layer: Layer.Layer<Service, never, SymphonyRepo.Service | Config.Service | HttpClient.HttpClient> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const config = yield* Config.Service
      const http = yield* HttpClient.HttpClient
      const scope = yield* Scope.Scope

      let pollingFiber: Option.Option<Fiber.Fiber<void>> = Option.none()

      const enqueue = Effect.fn("Symphony.enqueue")(function* (input: {
        repo_owner: string
        repo_name: string
        issue_number: number
        title: string
        body?: string
        metadata?: Record<string, unknown>
      }) {
        const id = crypto.randomUUID() as IssueID

        const row = yield* repo
          .insertIssue({
            id,
            repo_owner: input.repo_owner,
            repo_name: input.repo_name,
            issue_number: input.issue_number,
            title: input.title,
            body: input.body ?? null,
            status: "queued" as IssueStatus,
            worktree_name: null,
            metadata: input.metadata ?? {},
          })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        return {
          issue: new Issue({
            id: row.id,
            repo_owner: row.repo_owner,
            repo_name: row.repo_name,
            issue_number: row.issue_number,
            title: row.title,
            body: row.body,
            status: row.status as IssueStatus,
            worktree_name: row.worktree_name,
            metadata: row.metadata,
          }),
        }
      })

      const processNext = Effect.fn("Symphony.processNext")(function* () {
        const issues = yield* repo
          .listIssues("queued" as IssueStatus)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        if (issues.length === 0) return

        const issue = issues[0]

        const currentStatus = issue.status as IssueStatus
        const targetStatus: IssueStatus = "processing"
        if (!isValidTransition(currentStatus, targetStatus)) {
          return yield* new QueueError({
            message: `Cannot transition issue ${issue.id} from ${currentStatus} to processing`,
          })
        }

        yield* repo
          .updateIssueStatus(issue.id, targetStatus)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // Create workspace stub
        // TODO: Phase 2 - use Worktree service to create actual git worktree
        const wsID = crypto.randomUUID() as WorkspaceID
        yield* repo
          .insertWorkspace({
            id: wsID,
            issue_id: issue.id,
            directory: "",
            branch: "",
            status: "creating" as WorkspaceStatus,
          })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))
      })

      const startPolling = Effect.fn("Symphony.startPolling")(function* () {
        if (Option.isSome(pollingFiber)) return

        const info = yield* config.get()
        const symphonyConfig = info.symphony
        if (!symphonyConfig?.enabled) return

        const interval = symphonyConfig.github?.polling_interval_seconds ?? 30
        const repos = symphonyConfig.github?.repos ?? []

        const fiber = yield* Effect.gen(function* () {
          for (const repoStr of repos) {
            const parts = repoStr.split("/")
            if (parts.length !== 2) continue

            const request = HttpClientRequest.get(
              `https://api.github.com/repos/${parts[0]}/${parts[1]}/issues?state=open&per_page=10&sort=created&direction=desc`,
            ).pipe(HttpClientRequest.acceptJson)

            yield* http.execute(request).pipe(Effect.ignore)
          }
        }).pipe(
          Effect.repeat(Schedule.fixed(Duration.seconds(interval))),
          Effect.asVoid,
          Effect.forkIn(scope),
        )

        pollingFiber = Option.some(fiber)
      })

      const stopPolling = Effect.fn("Symphony.stopPolling")(function* () {
        if (Option.isSome(pollingFiber)) {
          yield* Fiber.interrupt(pollingFiber.value)
          pollingFiber = Option.none()
        }
      })

      return Service.of({ enqueue, processNext, startPolling, stopPolling })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(SymphonyRepo.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Config.defaultLayer),
)

export * as Symphony from "./symphony"


