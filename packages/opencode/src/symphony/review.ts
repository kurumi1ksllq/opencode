import { Context, Effect, Layer, Option } from "effect"
import { ReviewError, ReviewResult, type TaskID } from "./schema"
import { SymphonyRepo } from "./repo"

// --- Review Interface ---
export interface Interface {
  readonly reviewTask: (taskId: TaskID) => Effect.Effect<ReviewResult, ReviewError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SymphonyReview") {}

// --- Layer ---
export const layer: Layer.Layer<Service, never, SymphonyRepo.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* SymphonyRepo.Service

    const reviewTask = Effect.fn("Review.reviewTask")(function* (taskId: TaskID) {
      // 1. Fetch task
      const taskOpt = yield* repo.getTask(taskId).pipe(
        Effect.mapError((e) => new ReviewError({ message: e.message })),
      )
      if (Option.isNone(taskOpt)) {
        return yield* new ReviewError({ message: `Task ${taskId} not found` })
      }
      const task = taskOpt.value

      // 2. Validate status — can only review completed tasks
      if (task.status !== "completed") {
        return yield* new ReviewError({ message: `Can only review completed tasks, got ${task.status}` })
      }

      // 3. Basic checks for Phase 3a (no LLM):
      //    - Must have a result
      //    - Result must be non-empty
      if (!task.result || task.result.trim().length === 0) {
        return new ReviewResult({ passed: false, feedback: "No result produced" })
      }

      // 4. All basic checks passed
      return new ReviewResult({ passed: true })
    })

    return Service.of({ reviewTask })
  }),
)

export const defaultLayer = layer

export * as Review from "./review"
