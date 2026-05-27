# Core Package

This package provides core type definitions, Effect service infrastructure, the plugin system, and utility helpers used across the monorepo. It is imported by `opencode`, `ui`, and plugin packages.

## Exports

There is no barrel `index.ts`. Every `.ts` file in `src/` is independently accessible via the wildcard export:

```json
"./*": "./src/*.ts"
```

Import directly:

```ts
import { Permission } from "@opencode-ai/core/permission"
import { Plugin } from "@opencode-ai/core/plugin"
```

Follow the `export * as X from "./x"` pattern (see [packages/opencode/AGENTS.md](../opencode/AGENTS.md) for details).

## Plugin System

The plugin system in `src/plugin.ts` defines typed hook specs using Effect types (`"catalog.transform"`, `"aisdk.language"`, `"agent.update"`, etc.). Sub-directories in `src/plugin/` provide infrastructure:

- `provider.ts` / `provider/` — provider registration and layer setup
- `boot.ts` — plugin boot sequence
- `env.ts` — environment integration
- `account.ts` — account-level plugin support
- `models-dev.ts` — development model registration

All plugin code uses Effect framework patterns (`Context`, `Effect`, `Layer`, `Schema`).

## Effect Services

Core service files follow the same conventions as `packages/opencode`:

- `Effect.fn("Domain.method")` for named/traced effects
- `Effect.gen(function* () { ... })` for composition
- Service classes extend `Context.Tag` and project via `export * as X from "./x"`

Service infrastructure in `src/effect/`:

- `runtime.ts` — `makeRuntime` and layer infrastructure (shared with opencode package)
- `logger.ts` — Effect logger integration
- `memo-map.ts` — `Effect.cached`-style deduplication
- `observability.ts` — OpenTelemetry integration (`@effect/opentelemetry`)
- `service-use.ts` — typed service usage helpers

## Schema Helpers

`src/schema.ts` exports branded schemas (`AbsolutePath`, `RelativePath`), numeric constraints (`PositiveInt`, `NonNegativeInt`), the `DeepMutable` type, the `withStatics` helper, and the `Newtype` class.

`withStatics` attaches static methods to a schema via `.pipe()`:

```ts
export const Foo = fooSchema.pipe(
  withStatics((schema) => ({
    zero: schema.make(0),
    from: Schema.decodeUnknownOption(schema),
  }))
)
```

`Newtype` provides a nominal wrapper for scalar types with proper `Schema.Opaque` integration:

```ts
class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
  static make(id: string): QuestionID {
    return this.make(id)
  }
}
```

## github-copilot/

The `src/github-copilot/` directory contains GitHub Copilot provider integration (`copilot-provider.ts`, `openai-compatible-error.ts`, `chat/`, `responses/`) with its own README. Keep changes here scoped to GitHub Copilot compatibility — do not leak opencode-specific session logic into this directory.

## Utility Modules

`src/util/` contains 18 generic utility files:

- Data: `array.ts`, `binary.ts`, `hash.ts`, `path.ts`, `glob.ts`, `slug.ts`
- Error handling: `error.ts`, `log.ts`, `retry.ts`
- Concurrency: `effect-flock.ts`, `flock.ts`
- Integration: `module.ts`, `opencode-process.ts`
- Misc: `encode.ts`, `identifier.ts`, `lazy.ts`, `iife.ts`, `wildcard.ts`

These are Effect-free where possible. Import them directly.

## Tests

- Run: `bun test` from `packages/core`
- Test files co-locate with source (e.g. `session-message-updater.test.ts`)
- Effect tests use standard `Effect.gen` with `runPromise`
