import { Context, Effect, Layer, Schema } from "effect"
import { LLM, LLMClient, type LLMError } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"
import { RequestExecutor } from "@opencode-ai/llm/route"
import { DecomposeError, DecomposeTask } from "./schema"
import { decomposeJobTask } from "./decompose"

export interface DecomposerInterface {
  readonly decompose: (
    title: string,
    body?: string,
  ) => Effect.Effect<Array<{ title: string; description: string; acceptance: string[] }>, DecomposeError>
}

export class Decomposer extends Context.Service<Decomposer, DecomposerInterface>()("@opencode/Symphony/Decomposer") {}

// LLM-based decomposer — uses opencode's LLM infrastructure
export const llmDecomposer = Layer.effect(
  Decomposer,
  Effect.gen(function* () {
    const decompose = Effect.fn("Decomposer.decompose")(function* (title: string, body?: string) {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        // No LLM available — fall back to keyword heuristics
        return decomposeJobTask(title, body)
      }

      const model = OpenAI.configure({ apiKey }).responses("gpt-4o-mini")

      const systemPrompt = `You are a task planner for an autonomous coding agent. Given an issue title and description, break it down into a sequence of 1-6 concrete, actionable tasks. Each task must have:
- id: a single letter (A, B, C, ...) indicating execution order
- title: short action-oriented name
- description: 1-2 sentence explanation of what to do
- acceptance: 2-3 specific acceptance criteria
- depends_on: array of task IDs this task depends on (usually the previous task)

Rules:
- Tasks should be in dependency order (task A should not depend on B if A comes first)
- Max 6 tasks
- Each task should be independently executable
- Return ONLY valid JSON, no markdown, no explanation`

      const userPrompt = `Issue: ${title}${body ? `\n\nDescription: ${body}` : ""}`

      const request = LLM.request({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        generation: { maxTokens: 4096 },
      })

      const response = yield* LLMClient.generate(request).pipe(
        Effect.mapError((cause: LLMError) => new DecomposeError({ message: cause.message })),
      )

      // Parse JSON from LLM response
      let parsed: Array<{ title: string; description: string; acceptance: string[] }>
      try {
        const raw = JSON.parse(response.text)
        const tasks = Array.isArray(raw) ? raw : raw.tasks ?? []
        parsed = tasks.map((t: any) => ({
          title: String(t.title ?? ""),
          description: String(t.description ?? ""),
          acceptance: Array.isArray(t.acceptance) ? t.acceptance.map(String) : [],
        }))
      } catch {
        // JSON parse failed — fall back to keyword heuristics
        return decomposeJobTask(title, body)
      }

      if (parsed.length === 0) {
        return decomposeJobTask(title, body)
      }

      return parsed.slice(0, 8)
    })

    return Decomposer.of({ decompose })
  }),
)

// Keyword-based decomposer (fallback — wraps the pure function in an Effect)
export const keywordDecomposer = Layer.succeed(
  Decomposer,
  Decomposer.of({
    decompose: (title, body) => Effect.succeed(decomposeJobTask(title, body)),
  }),
)
