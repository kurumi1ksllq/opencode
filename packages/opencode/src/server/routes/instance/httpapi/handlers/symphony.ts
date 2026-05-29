import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Symphony } from "@/symphony/symphony"

export const symphonyHandlers = HttpApiBuilder.group(InstanceHttpApi, "symphony", (handlers) =>
  Effect.gen(function* () {
    const symphony = yield* Symphony.Service

    const queue = Effect.fn("SymphonyHttpApi.queue")(function* () {
      return yield* symphony.getQueueStats().pipe(Effect.orDie)
    })

    return handlers.handle("queue", queue)
  }),
)
