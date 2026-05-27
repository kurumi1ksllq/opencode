# Split Provider Files - Learnings

## Strategy
- Split oversized provider/ files (provider.ts 1033→522, transform.ts 1376→345, custom-providers.ts 778→398) by extracting functions to new files, maintaining all public exports via re-exports.
- Key principle: extract, don't refactor. Keep function internals identical, just move them.

## New Files Created
- `bundled-providers.ts` (51 lines) — `BUNDLED_PROVIDERS` record, `BundledSDK`, `CustomModelLoader`, `CustomVarsLoader`, `CustomDiscoverModels`, `CustomLoader`, `CustomDep` types
- `model-messages.ts` (430 lines) — message transformation functions (`normalizeMessages`, `message`, `applyCaching`, `unsupportedParts`, etc.)
- `model-variants.ts` (488 lines) — `variants()` function + reasoning effort helpers
- `model-transform.ts` (344 lines) — `resolveSDK`, `fromModelsDevProvider`, `sort`, `parseModel`, `modelSuggestions`, etc.
- `amazon-bedrock.ts` (137 lines) — amazon-bedrock custom provider loader
- `gitlab.ts` (145 lines) — gitlab custom provider loader

## Key Decisions
1. `resolveSDK` was moved from inside the `Layer.effect` generator to module level in `model-transform.ts`. Safe because it's a plain `async function` with no generator dependencies.
2. `iife()` helper must NOT have `()` appended — the helper already invokes the function. Extra `()` caused type errors.
3. `sdkKey()` needed to be exported from `model-messages.ts` since it's used by `providerOptions()` in `transform.ts`.
4. `BundledSDK` must use `import type` due to `verbatimModuleSyntax` setting.
5. Re-export chain: provider.ts re-exports from schema.ts (schemas) and model-transform.ts (helpers) to maintain public API.
6. `ListResult` and `ConfigProvidersResult` stay in schema.ts, NOT model-transform.ts — they're schemas.

## Verification
- `bun typecheck` — zero errors
- `bun test test/provider/` — 340 pass, 0 fail, 643 expect() calls
- Pre-existing failures in `path-traversal.test.ts` (unrelated)
