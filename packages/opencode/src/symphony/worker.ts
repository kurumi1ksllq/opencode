import { Context, Effect, Layer, Option } from "effect"
import { LLM, LLMClient, type LLMError } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"
import { RequestExecutor } from "@opencode-ai/llm/route"
import { Config } from "@/config/config"
import { WorkerError, SymphonyRepoError, type TaskID, type TaskStatus, type PlanID, TaskDef } from "./schema"
import type { TaskDefRow } from "./repo"
import { SymphonyRepo } from "./repo"
import { isPlanComplete, markFailedDependents } from "./plan"

const MAX_RETRIES = 3

// ---------------------------------------------------------------------------
// TaskExecutor (pluggable execution strategy)
// ---------------------------------------------------------------------------

export interface TaskExecutorInterface {
  readonly execute: (task: TaskDefRow) => Effect.Effect<string, WorkerError>
}

export class TaskExecutor extends Context.Service<TaskExecutor, TaskExecutorInterface>()("@opencode/Worker/TaskExecutor") {}

// Default mock executor — returns a canned result
export const defaultTaskExecutor = Layer.succeed(
  TaskExecutor,
  TaskExecutor.of({
    execute: (task) => Effect.succeed(`[mock] Task "${task.title}" completed`),
  }),
)

// Real LLM-based executor — uses opencode's LLM infrastructure
export const llmTaskExecutor = Layer.effect(
  TaskExecutor,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const execute = Effect.fn("TaskExecutor.execute")(function* (task: TaskDefRow) {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        return yield* Effect.fail(new WorkerError({ message: "No OPENAI_API_KEY environment variable set" }))
      }

      const model = OpenAI.configure({ apiKey }).responses("gpt-4o-mini")

      const request = LLM.request({
        model,
        system: task.prompt_template || "Execute the following task. Return a complete and actionable result.",
        prompt: `# ${task.title}\n\n${task.description}`,
        generation: { maxTokens: 4096 },
      })

      const response = yield* LLMClient.generate(request).pipe(
        Effect.mapError((cause: LLMError) => new WorkerError({ message: cause.message, cause })),
      )

      return response.text
    })

    return TaskExecutor.of({ execute })
  }),
)

// ---------------------------------------------------------------------------
// Worker Interface
// ---------------------------------------------------------------------------

export interface Interface {
  readonly executeTask: (taskId: TaskID) => Effect.Effect<void, WorkerError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SymphonyWorker") {}

// ---------------------------------------------------------------------------
// Helper: convert DB row to Schema class so plan functions work correctly
// (DB stores depends_on / acceptance_criteria as JSON strings)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const layer: Layer.Layer<Service, never, SymphonyRepo.Service | TaskExecutor> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* SymphonyRepo.Service
    const executor = yield* TaskExecutor

    const executeTaskFn = Effect.fn("Worker.executeTask")(function* (taskId: TaskID) {
      // 1. Fetch task
      const taskOpt = yield* repo.getTask(taskId)
      if (Option.isNone(taskOpt)) {
        return yield* Effect.fail(new WorkerError({ message: `Task ${taskId} not found` }))
      }
      const task = taskOpt.value

      // 2. Validate status — can only execute pending or ready tasks
      if (task.status !== "pending" && task.status !== "ready") {
        return yield* Effect.fail(new WorkerError({ message: `Cannot execute task ${taskId}: status is ${task.status}` }))
      }

      // 3. Transition to in_progress
      yield* repo.updateTaskStatus(taskId, "in_progress")

      // 4. Execute the task via pluggable executor
      const resultOrNull: string | null = yield* executor.execute(task).pipe(
        Effect.map((r) => r as string | null),
        Effect.catch((err) =>
          task.retry_count >= MAX_RETRIES
            ? repo.updateTaskStatus(taskId, "failed", { result: err.message }).pipe(
                Effect.andThen(repo.listTasksByPlan(task.plan_id as PlanID)),
                Effect.flatMap((tasks) => {
                  const updated = markFailedDependents(tasks.map(rowToTaskDef), taskId)
                  const skipped = updated.filter((t) => t.status === "skipped")
                  if (skipped.length === 0) return Effect.succeed(null as string | null)
                  return Effect.all(skipped.map((t) => repo.updateTaskStatus(t.id, "skipped"))).pipe(
                    Effect.as(null as string | null),
                  )
                }),
              )
            : repo.updateTaskStatus(taskId, "pending", { retry_count: task.retry_count + 1 }).pipe(
                Effect.as(null as string | null),
              ),
        ),
      )

      // If executor failed (handled above), we're done
      if (resultOrNull === null) return

      // 5. Success: store result and mark complete
      yield* repo.updateTaskResult(taskId, resultOrNull)
      yield* repo.updateTaskStatus(taskId, "completed")

      // 6. Check if plan is complete
      const allTasks = yield* repo.listTasksByPlan(task.plan_id as PlanID)
      if (isPlanComplete(allTasks.map(rowToTaskDef))) {
        yield* repo.updatePlanStatus(task.plan_id as PlanID, "completed")
      }
    })

    const executeTask = (taskId: TaskID) =>
      executeTaskFn(taskId).pipe(
        Effect.catchTag("SymphonyRepoError", (e: SymphonyRepoError) =>
          Effect.fail(new WorkerError({ message: e.message, cause: e })),
        ),
      )

    return Service.of({ executeTask })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(
    llmTaskExecutor.pipe(
      Layer.provide(LLMClient.layer.pipe(
        Layer.provide(RequestExecutor.defaultLayer),
      )),
    ),
  ),
)

export * as Worker from "./worker"
