import { Context, Duration, Effect, Fiber, Layer, Option, Schedule, Scope, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { Worktree } from "@/worktree"
import { Config } from "@/config/config"
import { ConfigSymphony } from "./config/symphony"
import { GitHubIssue, Job, JobID, JobStatus, PlanID, QueueError, TaskDef, TaskID, TaskStatus, Workspace, WorkspaceID, WorkspaceStatus } from "./schema"
import { SymphonyRepo } from "./repo"
import type { TaskDefRow } from "./repo"
import { Review } from "./review"
import { Worker } from "./worker"
import { decomposeJobTask } from "./decompose"
import { getReadyTasks, isPlanComplete } from "./plan"

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface QueueStats {
  readonly queued: number
  readonly processing: number
  readonly completed: number
  readonly failed: number
  readonly total: number
  readonly polling_active: boolean
  readonly repos: string[]
  readonly enabled: boolean
}

export interface Interface {
  readonly enqueue: (input: {
    source: "github" | "scheduled" | "manual" | "system"
    type: string
    title: string
    payload?: Record<string, unknown>
    priority?: number
  }) => Effect.Effect<{ job: Job; workspace?: Workspace }, QueueError>
  readonly processNext: () => Effect.Effect<void, QueueError>
  readonly pollIssues: () => Effect.Effect<void>
  readonly startPolling: () => Effect.Effect<void>
  readonly stopPolling: () => Effect.Effect<void>
  readonly getQueueStats: () => Effect.Effect<QueueStats, QueueError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Symphony") {}

const isValidTransition = (from: JobStatus, to: JobStatus): boolean => {
  const transitions: Record<JobStatus, readonly JobStatus[]> = {
    pending: ["queued"],
    queued: ["processing"],
    processing: ["completed", "failed"],
    completed: [],
    failed: [],
  }
  return transitions[from]?.includes(to) ?? false
}

// Helper: convert DB row to Schema class for plan functions
function rowToTaskDef(row: TaskDefRow): TaskDef {
  return new TaskDef({
    id: row.id,
    plan_id: row.plan_id,
    title: row.title,
    description: row.description,
    acceptance_criteria: JSON.parse(row.acceptance_criteria) as string[],
    depends_on: JSON.parse(row.depends_on) as string[],
    prompt_template: row.prompt_template,
    status: row.status as TaskStatus,
    result: row.result ?? undefined,
    assigned_to: row.assigned_to ?? undefined,
    created_at: row.time_created,
    updated_at: row.time_updated,
  })
}

export const layer: Layer.Layer<Service, never, SymphonyRepo.Service | Config.Service | HttpClient.HttpClient | Worktree.Service | Worker.Service | Review.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const repo = yield* SymphonyRepo.Service
      const config = yield* Config.Service
      const http = yield* HttpClient.HttpClient
      const scope = yield* Scope.Scope
      const worktree = yield* Worktree.Service
      const worker = yield* Worker.Service
      const review = yield* Review.Service

      let pollingFiber: Option.Option<Fiber.Fiber<void, never>> = Option.none()

      const enqueue = Effect.fn("Symphony.enqueue")(function* (input: {
        source: "github" | "scheduled" | "manual" | "system"
        type: string
        title: string
        payload?: Record<string, unknown>
        priority?: number
      }) {
        const id = crypto.randomUUID() as JobID

        const row = yield* repo
          .insertJob({
            id,
            source: input.source,
            type: input.type,
            title: input.title,
            payload: input.payload ?? {},
            priority: input.priority ?? 5,
            status: "queued" as JobStatus,
            worktree_name: null,
          })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        return {
          job: new Job({
            id: row.id,
            source: row.source as "github" | "scheduled" | "manual" | "system",
            type: row.type,
            title: row.title,
            payload: row.payload,
            priority: row.priority,
            status: row.status as JobStatus,
            worktree_name: row.worktree_name,
          }),
        }
      })

      const processNext = Effect.fn("Symphony.processNext")(function* () {
        const jobs = yield* repo
          .listJobs("queued" as JobStatus)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        if (jobs.length === 0) return

        const job = jobs[0]

        const currentStatus = job.status as JobStatus
        const targetStatus: JobStatus = "processing"
        if (!isValidTransition(currentStatus, targetStatus)) {
          return yield* new QueueError({
            message: `Cannot transition job ${job.id} from ${currentStatus} to processing`,
          })
        }

        yield* repo
          .updateJobStatus(job.id, targetStatus)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // Create git worktree for this job
        const worktreeInfo = yield* worktree
          .makeWorktreeInfo({ name: `symphony-job-${job.id.slice(0, 8)}` })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        yield* worktree
          .createFromInfo(worktreeInfo)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // Record workspace in database
        const wsID = crypto.randomUUID() as WorkspaceID
        yield* repo
          .insertWorkspace({
            id: wsID,
            job_id: job.id,
            directory: worktreeInfo.directory,
            branch: worktreeInfo.branch ?? "",
            status: "ready" as WorkspaceStatus,
          })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // --- Phase 3: Decompose job into Plan + TaskDefs ---
        const body = typeof job.payload?.body === "string" ? job.payload.body : undefined
        const decomposed = decomposeJobTask(job.title, body)
        if (decomposed.length === 0) return

        const planId = crypto.randomUUID() as PlanID
        yield* repo
          .insertPlan({ id: planId, workspace_id: wsID, goal: job.title })
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // Transition plan from "draft" to "active"
        yield* repo
          .updatePlanStatus(planId, "active")
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        // Insert all TaskDefs with sequential dependencies
        const taskIds: TaskID[] = decomposed.map(() => crypto.randomUUID() as TaskID)
        for (let i = 0; i < decomposed.length; i++) {
          const td = decomposed[i]
          const deps: string[] = i > 0 ? [taskIds[i - 1]] : []
          yield* repo
            .insertTask({
              id: taskIds[i],
              plan_id: planId,
              title: td.title,
              description: td.description,
              acceptance_criteria: td.acceptance,
              depends_on: deps,
              prompt_template: td.description,
            })
            .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))
        }

        // Execute ready tasks via Worker
        const allTaskRows = yield* repo
          .listTasksByPlan(planId)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        const allTaskDefs = allTaskRows.map(rowToTaskDef)
        const ready = getReadyTasks(allTaskDefs)

        for (const task of ready) {
          yield* worker.executeTask(task.id).pipe(
            Effect.catch((err) =>
              Effect.logWarning("Task execution failed", { taskId: task.id, error: err.message }),
            ),
          )

          // Review the completed task
          yield* review.reviewTask(task.id).pipe(
            Effect.andThen((result) => {
              if (result.passed) {
                return Effect.logInfo("Task review passed", { taskId: task.id })
              }
              return Effect.logWarning("Task review failed", {
                taskId: task.id,
                feedback: result.feedback ?? "none",
              })
            }),
            Effect.catch((err) =>
              Effect.logWarning("Task review error (skipped)", {
                taskId: task.id,
                error: err.message,
              }),
            ),
          )
        }

        // Phase 4: If plan is complete, create PR and close the GitHub issue
        const finalTasks = yield* repo
          .listTasksByPlan(planId)
          .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

        if (isPlanComplete(finalTasks.map(rowToTaskDef))) {
          yield* repo
            .updatePlanStatus(planId, "completed")
            .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))

          // For GitHub-sourced jobs: create PR, comment on issue, close issue
          if (job.source === "github" && job.payload?.repo_owner && job.payload?.repo_name && job.payload?.issue_number) {
            const cfg = yield* config.get()
            const owner = job.payload.repo_owner as string
            const name = job.payload.repo_name as string
            const issueNumber = job.payload.issue_number as number
            const branch = worktreeInfo.branch ?? ""
            const ghToken = cfg.symphony?.github?.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? undefined

            yield* createGithubPR(owner, name, job.title, branch, job.payload.body as string | undefined, ghToken).pipe(
              Effect.andThen((prUrl) =>
                addIssueComment(owner, name, issueNumber, prUrl, ghToken).pipe(
                  Effect.andThen(() => closeIssue(owner, name, issueNumber, ghToken)),
                ),
              ),
              Effect.catch((err) =>
                Effect.logWarning("Failed to create PR / close issue", {
                  repo: `${owner}/${name}`,
                  issue: issueNumber,
                  error: err.message,
                }),
              ),
            )
          }

          yield* repo
            .updateJobStatus(job.id, "completed")
            .pipe(Effect.mapError((cause) => new QueueError({ message: cause.message, cause })))
        }
      })

      const processRepoIssues = Effect.fn("Symphony.processRepoIssues")(
        (owner: string, name: string, repoStr: string, token?: string) =>
          Effect.gen(function* () {
            let request = HttpClientRequest.get(
              `https://api.github.com/repos/${owner}/${name}/issues?state=open&per_page=10&sort=created&direction=desc`,
            ).pipe(HttpClientRequest.acceptJson)

            if (token) {
              request = request.pipe(HttpClientRequest.bearerToken(token))
            }

            const httpOk = HttpClient.filterStatusOk(http)
            const response = yield* httpOk.execute(request)
            const issues = yield* HttpClientResponse.schemaBodyJson(Schema.Array(GitHubIssue))(response)

            for (const issue of issues) {
              const existing = yield* repo.findJobByIssue({
                repo_owner: owner,
                repo_name: name,
                issue_number: issue.number,
              })
              if (Option.isSome(existing)) continue

              yield* enqueue({
                source: "github",
                type: "issue",
                title: issue.title,
                payload: {
                  repo_owner: owner,
                  repo_name: name,
                  issue_number: issue.number,
                  body: issue.body ?? undefined,
                  html_url: issue.html_url,
                  github_id: issue.id,
                  labels: issue.labels.map((l: { name: string }) => l.name),
                  user: issue.user?.login ?? undefined,
                },
                priority: 5,
              })

              yield* Effect.logInfo("Enqueued job from GitHub issue", {
                repo: repoStr,
                issue: issue.number,
                title: issue.title,
              })
            }
          }),
      )

      const pollIssues = Effect.fn("Symphony.pollIssues")(function* () {
        const info = yield* config.get()
        const symphonyConfig = info.symphony
        if (!symphonyConfig?.enabled) return

        const repos = symphonyConfig.github?.repos ?? []
        if (repos.length === 0) return

        const token = symphonyConfig.github?.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? undefined

        for (const repoStr of repos) {
          const parts = repoStr.split("/")
          if (parts.length !== 2) {
            yield* Effect.logWarning("Invalid repo string in config", { repo: repoStr })
            continue
          }

          const [owner, name] = parts

          yield* processRepoIssues(owner, name, repoStr, token).pipe(
            Effect.catch((err) =>
              Effect.logWarning("GitHub polling error for repo", {
                repo: repoStr,
                error: err.message,
              }),
            ),
          )
        }
      })

      const pollScheduled = Effect.fn("Symphony.pollScheduled")(function* () {
        const info = yield* config.get()
        const scheduled = info.symphony?.scheduled ?? []
        if (scheduled.length === 0) return

        for (const task of scheduled) {
          yield* enqueue({
            source: "scheduled",
            type: task.type,
            title: task.title,
            payload: task.payload ?? {},
            priority: task.priority ?? 5,
          }).pipe(
            Effect.catch((err) =>
              Effect.logWarning("Failed to enqueue scheduled task", {
                task: task.task_name,
                error: err.message,
              }),
            ),
          )

          yield* Effect.logInfo("Enqueued scheduled task", {
            task: task.task_name,
            title: task.title,
            type: task.type,
          })
        }
      })

      const startPolling = Effect.fn("Symphony.startPolling")(function* () {
        if (Option.isSome(pollingFiber)) return

        const info = yield* config.get()
        if (!info.symphony?.enabled) return

        const interval = info.symphony.github?.polling_interval_seconds ?? 30

        const fiber = yield* Effect.all([
          pollIssues().pipe(
            Effect.repeat(Schedule.fixed(Duration.seconds(interval))),
            Effect.asVoid,
          ),
          pollScheduled().pipe(
            Effect.repeat(Schedule.fixed(Duration.seconds(interval))),
            Effect.asVoid,
          ),
        ]).pipe(Effect.asVoid, Effect.forkIn(scope))

        pollingFiber = Option.some(fiber)
      })

      const stopPolling = Effect.fn("Symphony.stopPolling")(function* () {
        if (Option.isSome(pollingFiber)) {
          yield* Fiber.interrupt(pollingFiber.value)
          pollingFiber = Option.none()
        }
      })

      const getQueueStats = Effect.fn("Symphony.getQueueStats")(function* () {
        const jobs = yield* repo.listJobs().pipe(
          Effect.mapError((cause) => new QueueError({ message: cause.message, cause })),
        )
        const info = yield* config.get()
        const symphonyConfig = info.symphony
        const repos = symphonyConfig?.github?.repos ?? []
        const queued = jobs.filter((j) => j.status === "queued").length
        const processing = jobs.filter((j) => j.status === "processing").length
        const completed = jobs.filter((j) => j.status === "completed").length
        const failed = jobs.filter((j) => j.status === "failed").length
        return {
          queued,
          processing,
          completed,
          failed,
          total: jobs.length,
          polling_active: Option.isSome(pollingFiber),
          repos,
          enabled: symphonyConfig?.enabled ?? false,
        } as QueueStats
      })

      // -----------------------------------------------------------------------
      // GitHub API helpers (Phase 4: PR creation + issue close)
      // -----------------------------------------------------------------------

      const postJson = (url: string, body: unknown, token?: string) => {
        let req = HttpClientRequest.post(url).pipe(HttpClientRequest.acceptJson)
        if (token) req = req.pipe(HttpClientRequest.bearerToken(token))
        return HttpClient.filterStatusOk(http).execute(req)
      }

      const createGithubPR = Effect.fn("Symphony.createGithubPR")(
        (owner: string, name: string, title: string, branch: string, bodyText: string | undefined, token?: string) =>
          Effect.gen(function* () {
            const response = yield* postJson(
              `https://api.github.com/repos/${owner}/${name}/pulls`,
              {
                title: `[Symphony] ${title}`,
                head: branch,
                base: "main",
                body: bodyText
                  ? `This PR was automatically generated by Symphony based on issue #${bodyText.slice(0, 80)}...\n\n${bodyText}`
                  : `This PR was automatically generated by Symphony to address: ${title}`,
                maintainer_can_modify: true,
              },
              token,
            )
            const data = yield* HttpClientResponse.schemaBodyJson(
              Schema.Struct({ html_url: Schema.String }),
            )(response)
            return data.html_url
          }),
      )

      const addIssueComment = Effect.fn("Symphony.addIssueComment")(
        (owner: string, name: string, issueNumber: number, prUrl: string, token?: string) =>
          Effect.gen(function* () {
            yield* postJson(
              `https://api.github.com/repos/${owner}/${name}/issues/${issueNumber}/comments`,
              { body: `✅ A pull request has been created for this issue: ${prUrl}` },
              token,
            )
          }),
      )

      const closeIssue = Effect.fn("Symphony.closeIssue")(
        (owner: string, name: string, issueNumber: number, token?: string) =>
          Effect.gen(function* () {
            yield* postJson(
              `https://api.github.com/repos/${owner}/${name}/issues/${issueNumber}`,
              { state: "closed", state_reason: "completed" },
              token,
            )
          }),
      )

      const svc = Service.of({ enqueue, processNext, pollIssues, startPolling, stopPolling, getQueueStats })

      // Auto-start polling on layer initialization.
      // Checks config.symphony.enabled — if disabled, returns immediately.
      // Forked into the layer scope so it's cleaned up on app shutdown.
      yield* startPolling().pipe(Effect.forkIn(scope))

      return svc
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Worktree.defaultLayer),
  Layer.provide(Worker.defaultLayer),
  Layer.provide(Review.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(SymphonyRepo.layer),
)

export * as Symphony from "./symphony"


