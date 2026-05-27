import { Effect, Schema } from "effect"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false)),
  ),
  github: Schema.optional(
    Schema.Struct({
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
