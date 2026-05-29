import { Effect, Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false)),
  ),
  github: Schema.optional(
    Schema.Struct({
      token: Schema.optional(Schema.String),
      polling_interval_seconds: Schema.optional(Schema.Number).pipe(
        Schema.withDecodingDefaultType(Effect.succeed(30)),
      ),
      repos: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).pipe(
        Schema.withDecodingDefaultType(Effect.succeed([])),
      ),
    }),
  ).pipe(
    Schema.withDecodingDefaultType(Effect.succeed({ polling_interval_seconds: 30, repos: [] })),
  ),
  scheduled: Schema.optional(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({
          task_name: Schema.String,
          title: Schema.String,
          type: Schema.String,
          payload: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
          interval_seconds: Schema.Number,
          priority: Schema.optional(Schema.Number),
        }),
      ),
    ),
  ).pipe(
    Schema.withDecodingDefaultType(Effect.succeed<Array<{
      task_name: string
      title: string
      type: string
      payload?: Record<string, unknown>
      interval_seconds: number
      priority?: number
    }>>([])),
  ),
  workers: Schema.optional(
    Schema.Struct({
      max_concurrent: Schema.optional(Schema.Number).pipe(
        Schema.withDecodingDefaultType(Effect.succeed(1)),
      ),
    }),
  ).pipe(
    Schema.withDecodingDefaultType(Effect.succeed({ max_concurrent: 1 })),
  ),
})

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSymphony from "./symphony"
