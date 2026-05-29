import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"

export const SymphonyQueueStats = Schema.Struct({
  queued: Schema.Number,
  processing: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  total: Schema.Number,
  polling_active: Schema.Boolean,
  repos: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
})

export const SymphonyApi = HttpApi.make("symphony").add(
  HttpApiGroup.make("symphony")
    .add(
      HttpApiEndpoint.get("queue", "/symphony/queue", {
        success: described(SymphonyQueueStats, "Symphony queue statistics"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "symphony.queue",
          summary: "Get Symphony queue statistics",
          description: "Returns counts of queued, processing, completed, and failed jobs plus polling state.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "symphony", description: "Symphony task queue routes." })),
)
