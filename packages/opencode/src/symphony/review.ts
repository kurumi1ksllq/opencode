import { Context, Effect, Layer, Option } from "effect"
import { LLM, LLMClient, type LLMError } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"
import { RequestExecutor } from "@opencode-ai/llm/route"
import { ReviewError, ReviewResult, type TaskID } from "./schema"
import { SymphonyRepo } from "./repo"

// --- Review Interface ---
export interface Interface {
  readonly reviewTask: (taskId: TaskID) => Effect.Effect<ReviewResult, ReviewError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SymphonyReview") {}

// --- Reviewer (pluggable review strategy) ---
export interface ReviewerInterface {
  readonly review: (title: string, description: string, acceptanceCriteria: string[], result: string) => Effect.Effect<ReviewResult, ReviewError>
}

export class Reviewer extends Context.Service<Reviewer, ReviewerInterface>()("@opencode/Symphony/Reviewer") {}

// LLM-based reviewer — uses opencode's LLM infrastructure
export const llmReviewer = Layer.effect(
  Reviewer,
  Effect.gen(function* () {
    const review = Effect.fn("Reviewer.review")(function* (
      title: string,
      description: string,
      acceptanceCriteria: string[],
      result: string,
    ) {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        // No LLM available — fall back to basic non-empty check
        if (!result || result.trim().length === 0) {
          return new ReviewResult({ passed: false, feedback: "No result produced" })
        }
        return new ReviewResult({ passed: true })
      }

      const model = OpenAI.configure({ apiKey }).responses("gpt-4o-mini")

      const systemPrompt = `You are a code review assistant. Given a task with acceptance criteria and its execution result, determine whether the result satisfies the criteria.

Return ONLY valid JSON with this shape:
{ "passed": boolean, "feedback": string }

- passed: true if the result meets ALL acceptance criteria, false otherwise
- feedback: specific explanation of what passed or failed (2-3 sentences)

No markdown, no explanation outside the JSON.`

      const acceptanceText = acceptanceCriteria.length > 0
        ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
        : "No specific acceptance criteria provided"

      const userPrompt = `Task: ${title}
Description: ${description}
Acceptance Criteria:
${acceptanceText}

Execution Result:
${result}`

      const request = LLM.request({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        generation: { maxTokens: 1024 },
      })

      const response = yield* LLMClient.generate(request).pipe(
        Effect.mapError((cause: LLMError) => new ReviewError({ message: cause.message })),
      )

      // Parse JSON from LLM response
      try {
        const raw = JSON.parse(response.text)
        return new ReviewResult({
          passed: raw.passed === true,
          feedback: typeof raw.feedback === "string" ? raw.feedback : undefined,
        })
      } catch {
        // JSON parse failed — fall back to basic check
        if (!result || result.trim().length === 0) {
          return new ReviewResult({ passed: false, feedback: "No result produced" })
        }
        return new ReviewResult({ passed: true })
      }
    })

    return Reviewer.of({ review })
  }),
)

// Default reviewer — basic non-empty check (fallback)
export const defaultReviewer = Layer.succeed(
  Reviewer,
  Reviewer.of({
    review: (title, description, acceptanceCriteria, result) => {
      if (!result || result.trim().length === 0) {
        return Effect.succeed(new ReviewResult({ passed: false, feedback: "No result produced" }))
      }
      return Effect.succeed(new ReviewResult({ passed: true }))
    },
  }),
)

// --- Layer (wires Reviewer into the Review service) ---
export const layer: Layer.Layer<Service, never, SymphonyRepo.Service | Reviewer> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const repo = yield* SymphonyRepo.Service
    const reviewer = yield* Reviewer

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

      // 3. Must have a result
      if (!task.result || task.result.trim().length === 0) {
        return new ReviewResult({ passed: false, feedback: "No result produced" })
      }

      // 4. Delegate to pluggable Reviewer (LLM or basic)
      const criteria: string[] = task.acceptance_criteria
        ? (typeof task.acceptance_criteria === "string"
            ? (JSON.parse(task.acceptance_criteria) as string[])
            : task.acceptance_criteria)
        : []
      return yield* reviewer.review(
        task.title,
        task.description,
        criteria,
        task.result,
      )
    })

    return Service.of({ reviewTask })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(
    llmReviewer.pipe(
      Layer.provide(LLMClient.layer.pipe(
        Layer.provide(RequestExecutor.defaultLayer),
      )),
    ),
  ),
)

export * as Review from "./review"
