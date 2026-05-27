# Giant File Splitting Plan

## TL;DR

> **Quick Summary**: Split 6 god files (>1500 lines each) into ~500-line modules through incremental, test-backed extraction — zero behavior change, 100% type safety preserved.
>
> **Deliverables**:
> - `provider/provider.ts` → 6 files: schema, errors, custom-providers, model-transform, util, service
> - `acp/agent.ts` → 6 files: skeleton, events, sessions, mode, prompt, helpers
> - `session/prompt.ts` → 6 files: schemas, loops, createUserMessage, handleSubtask, shellImpl, composer
> - `session/index.tsx` → 12+ files: context, main, sub-components (UserMessage, AssistantMessage, ReasoningPart, text/tool/renderer parts), individual tool renderers
> - `prompt/index.tsx` → 6 files: context, input, sidebar, output, suggestions, actions
> - `lsp/server.ts` → 2 files: server.ts (skeleton re-exports), server-data.ts (40 descriptors)
> - Test files added for all high-risk files before splitting
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3+4+4 waves
> **Critical Path**: Add tests → Split file → Verify → Cleanup re-exports

---

## Context

### Original Request
用户要求制定拆解 6 个巨型文件（>1500 行）的计划。这些文件使代码库难以导航、容易产生冲突、不利于并行开发。

### Interview Summary

**Key Discussions**:
- **范围**: 仅 6 个 >1500 行的巨文件，其他 1000-1500 行文件暂不处理
- **目标大小**: ~500 行/文件，硬上限 600 行，超出的在自然模块边界处接受
- **方法**: 先加关键测试 → 增量提取（每次一个模块） → 类型检查 + 全测试通过 → 提交 → 清理临时重导出
- **lsp/server.ts 处理**: 只拆出活跃逻辑（~200 行工具函数 + Handle 接口），40 个数据描述符保留在一个文件中
- **测试策略**: 高风险的 4 个文件在拆分前先做全面测试覆盖，匹配已有低风险文件的测试水平
- **零行为变更**: 纯重构，不分心优化/重命名/加注释/改格式

**Research Findings**:
- **6 个文件之间零相互导入**: 完全解耦——跨模块依赖通过 Effect service 接口流动，而非直接文件导入
- **每文件内部结构**: 已通过 explore agent 详细分析，每文件有明确的自然模块边界
- **low-risk 文件**: provider/provider.ts 和 session/prompt.ts 已有测试覆盖（provider 有 119 line test file）

### Metis Review

**Identified Gaps** (addressed):
- **循环依赖风险**: 零交叉导入消除此风险；每文件内模块提取遵循单向依赖（schemas→errors→service，而非反向）
- **Effect.gen 提取策略**: 提取内部函数时保留 Effect.gen 结构，不重构为 Effect.fn（零行为变更）
- **JSX 提取策略**: 提取为 SolidJS 组件，通过 props 传递 context（不改变 reactivity 图）
- **临时重导出协议**: 每次提取后从原文件 re-export → 提交 → 全部提取完后清理
- **硬行数上限**: 目标 500，硬上限 600
- **lsp/server 拆分验证**: 用户确认只拆活跃逻辑，数据对象不拆
- **回滚策略**: 连续 2 个以上破坏提交则 git revert

---

## Work Objectives

### Core Objective
将 6 个 >1500 行的 TypeScript 文件拆分为 ~500 行的模块文件，保持零行为变更。

### Concrete Deliverables
- `provider/provider.ts` 拆分为 6 个文件
- `acp/agent.ts` 拆分为 6 个文件
- `session/prompt.ts` 拆分为 6 个文件
- `session/index.tsx` 拆分为 12+ 个文件
- `prompt/index.tsx` 拆分为 6 个文件
- `lsp/server.ts` 拆分为 2 个文件
- 为 4 个高风险文件添加关键测试

### Definition of Done
- [x] `cd packages/opencode && bun typecheck` passes
- [x] `cd packages/opencode && bun test` passes (all tests, pre-existing failures only)
- [x] 每个新模块 ≤ 600 行
- [x] 公共导出无变化（验证 index.ts/diff）
- [x] 无新的循环依赖
- [x] 无新的 any/类型断言
- [x] 所有临时重导出已清理

### Must Have
- 提取后立即重导出，消费者引用不中断
- 每个提交只从一个源文件提取一个模块
- 高风险文件必须先通过测试门槛再拆分
- lsp/server.ts 只拆活跃逻辑，数据对象保留

### Must NOT Have (Guardrails)
- ❌ 不在拆分过程中改变内部逻辑（不将 Effect.gen 转为 Effect.fn）
- ❌ 不将共享工具提取到 core/
- ❌ 不修复拆分过程中发现的 bug（另提 issue）
- ❌ 不改名 exports/types（除非拆分必须）
- ❌ 不加 JSDoc/注释
- ❌ 不重构 session/index.tsx 的 reactivity 图
- ❌ 不动任何 6 个目标文件及其提取模块以外的文件
- ❌ 不添加/删除/修改公共导出

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES — bun test with vitest-style tests
- **Automated tests**: Tests-after (add tests BEFORE splitting high-risk files)
- **Framework**: bun test
- **Test patterns**: Follow existing patterns (e.g., `provider.test.ts`)

### QA Policy
Every task MUST include agent-executed QA scenarios.
- **TypeScript**: `bun typecheck` in packages/opencode
- **Unit tests**: `bun test` in packages/opencode
- **Export verification**: `bun run -e "..."` to compare exports
- **Evidence**: Output captured to `.sisyphus/evidence/task-{N}-{scenario}.txt`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Test-first — 4 parallel): Add tests for 4 high-risk files
├── T1: Add tests for acp/agent.ts
├── T2: Add tests for lsp/server.ts
├── T3: Add tests for session/index.tsx
└── T4: Add tests for prompt/index.tsx

Wave 2 (Split low-risk — 2 parallel, start right after tests):
├── T5: Split provider/provider.ts (6 files, ~500 lines each)
├── T6: Split session/prompt.ts (6 files, ~500 lines each)
├── T7: Split lsp/server.ts (2 files — active logic + data)
├── T8: Split acp/agent.ts (6 files — now with test coverage)

Wave 3 (Split remaining — 2 parallel):
├── T9: Split session/index.tsx (12+ files — now with test coverage)
└── T10: Split prompt/index.tsx (6 files — now with test coverage)

Wave FINAL (4 parallel reviews, then user ok):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

- **T1-T4**: No dependencies (parallel) → Blocks T7, T8, T9, T10
- **T5**: No dependencies → Independent
- **T6**: No dependencies → Independent
- **T7**: Blocks on T2 → After T2
- **T8**: Blocks on T1 → After T1
- **T9**: Blocks on T3 → After T3
- **T10**: Blocks on T4 → After T4
- **F1-F4**: Block on ALL T1-T10

### Agent Dispatch Summary

- **Wave 1**: 4 in parallel — `unspecified-high` (testing)
- **Wave 2**: 4 in parallel — T5→ `deep`, T6→ `deep`, T7→ `quick`, T8→ `deep`
- **Wave 3**: 2 in parallel — T9→ `deep`, T10→ `deep`
- **FINAL**: 4 in parallel — F1→ `oracle`, F2→ `unspecified-high`, F3→ `unspecified-high`, F4→ `deep`

---

## TODOs

- [x] 1. **Add critical tests for acp/agent.ts**

  **What to do**:
  - Read `acp/agent.ts` — identify critical paths: handleEvent, processMessage, prompt, cancel, session CRUD, mode resolution
  - Read existing test patterns in `packages/opencode/src/__tests__/` to match style
  - Create `packages/opencode/src/acp/agent.test.ts`
  - Cover: Agent lifecycle (EventStream setup → session iteration → close), message replay across sessions, prompt → cancel flow, session CRUD operations, mode resolution (defaultModel, lastUsedModel)
  - Focus on integration-level tests that exercise real behavior (avoid mocks)

  **Must NOT do**:
  - Don't test every helper function in isolation — test critical workflows
  - Don't modify agent.ts itself

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Testing requires understanding complex Effect-based ACP protocol flow, not just unit testing
  - **Skills**: [`effect`]
    - `effect`: Tests involve Effect services (EventStream, SessionManager) — must follow Effect testing patterns
  - **Skills Evaluated but Omitted**: None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 8 (acp/agent.ts splitting)
  - **Blocked By**: None

  **References**:
  - `packages/opencode/test/provider/provider.test.ts` — Existing test pattern for Effect service testing
  - `packages/opencode/src/acp/agent.ts` — The target file, need to understand critical paths
  - `packages/opencode/test/` — Test files live here (not co-located or in src/__tests__/)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Tests pass with meaningful coverage
    Tool: Bash
    Preconditions: Test file created at src/acp/agent.test.ts
    Steps:
      1. cd packages/opencode && bun test
      2. Check output includes test runs for agent
      3. Count test assertions — minimum 3 distinct test cases
    Expected Result: All tests pass. At least 3 meaningful test cases (verify by grep: describe/it count)
    Failure Indicators: bun test fails, test count < 3
    Evidence: .sisyphus/evidence/task-1-bun-test.txt

  Scenario: Test file follows existing conventions
    Tool: Bash
    Steps:
      1. Check file structure matches existing test patterns
      2. Verify import paths are correct
    Expected Result: Test file exists at expected location, uses same framework as other tests
    Evidence: .sisyphus/evidence/task-1-file-check.txt
  ```

  **Evidence to Capture:**
  - [ ] bun test output showing passing agent tests
  - [ ] Test file existence verification

  **Commit**: YES
  - Message: `test(opencode): add critical tests for acp/agent.ts`
  - Files: `packages/opencode/src/acp/agent.test.ts`
  - Pre-commit: `cd packages/opencode && bun typecheck && bun test`

---

- [x] 2. **Add critical tests for lsp/server.ts**

  **What to do**:
  - Read `lsp/server.ts` — identify what can be tested: export list stability, Handle interface implementation, server spawn/lookup by language
  - Create `packages/opencode/src/lsp/server.test.ts`
  - Cover: Export list matches expected server count (40 servers), Handle interface shape, `nearestRoot` factory function, platform-specific Roslyn helpers, server lookup by language ID
  - These are data-focused tests — verify the 40 server descriptors have expected structure

  **Must NOT do**:
  - Don't test actual LSP server spawning (no subprocess launches)
  - Don't modify server.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Complex LSP server descriptor structure requires thorough data validation tests
  - **Skills**: [] (no special skills needed — pure TypeScript testing)
  - **Skills Evaluated but Omitted**: None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 7 (lsp/server.ts splitting)
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/lsp/server.ts` — Target file
  - `packages/opencode/test/provider/provider.test.ts` — Test patterns

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Tests pass with 3+ test cases
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test src/lsp/server.test.ts
      2. grep for describe/it block names
    Expected Result: All tests pass, 3+ distinct test cases
    Evidence: .sisyphus/evidence/task-2-bun-test.txt

  Scenario: Server export structure validated
    Tool: Bash
    Steps:
      1. bun run -e "import {servers} from './src/lsp/server'; console.log(Object.keys(servers).length)"
    Expected Result: Output shows 40+ servers, counted from the module itself
    Evidence: .sisyphus/evidence/task-2-servers-count.txt
  ```

  **Evidence to Capture:**
  - [ ] bun test output
  - [ ] Server count verification

  **Commit**: YES
  - Message: `test(opencode): add critical tests for lsp/server.ts`
  - Files: `packages/opencode/src/lsp/server.test.ts`
  - Pre-commit: `cd packages/opencode && bun typecheck && bun test`

---

- [x] 3. **Add critical tests for session/index.tsx**

  **What to do**:
  - Read `session/index.tsx` — it's a SolidJS TUI component. Focus on testing: context creation/shape, command list generation, scrolling behavior if possible, message rendering
  - Since this is a SolidJS component with heavy TUI rendering, use snapshot tests on the JSX output or test the data processing functions (command list, message formatters)
  - Create `packages/opencode/src/cli/cmd/tui/routes/session/index.test.tsx`
  - Cover: Context object has correct properties, command list builds correctly, message formatting helper output matches expected shape, scroll helpers compute correctly

  **Must NOT do**:
  - Don't test actual rendering in terminal (unit test the logic)
  - Don't modify index.tsx

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: SolidJS TUI testing requires understanding both Effect patterns and SolidJS component testing
  - **Skills**: [] (no special skills)
  - **Skills Evaluated but Omitted**: None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 9 (session/index.tsx splitting)
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — Target file
  - `packages/opencode/test/provider/provider.test.ts` — Test patterns

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Tests pass with 3+ test cases
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test src/cli/cmd/tui/routes/session/index.test.tsx
      2. Check output for test results
    Expected Result: All tests pass, 3+ test cases
    Evidence: .sisyphus/evidence/task-3-bun-test.txt

  Scenario: Context helper functions work correctly
    Tool: Bash
    Steps:
      1. Verify the test exercises context creation or command list building
    Expected Result: Test file exists with meaningful assertions
    Evidence: .sisyphus/evidence/task-3-file-exists.txt
  ```

  **Evidence to Capture:**
  - [ ] bun test output
  - [ ] Test file existence

  **Commit**: YES
  - Message: `test(opencode): add critical tests for session/index.tsx`
  - Files: `packages/opencode/src/cli/cmd/tui/routes/session/index.test.tsx`
  - Pre-commit: `cd packages/opencode && bun typecheck && bun test`

---

- [x] 4. **Add critical tests for prompt/index.tsx**

  **What to do**:
  - Read `prompt/index.tsx` — Focus on testing: prompt input handling, suggestion generation, file reference resolution (from prompt.ts knowledge)
  - Create `packages/opencode/src/cli/cmd/tui/component/prompt/index.test.tsx`
  - Cover: Input state management, suggestion filtering, action dispatch
  - Test the data processing and state logic, not the rendering

  **Must NOT do**:
  - Don't test actual TUI rendering
  - Don't modify index.tsx

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: TUI component testing with SolidJS requires component test familiarity
  - **Skills**: [] (no special skills)
  - **Skills Evaluated but Omitted**: None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 10 (prompt/index.tsx splitting)
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — Target file
  - `packages/opencode/test/provider/provider.test.ts` — Test patterns

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: Tests pass with 3+ test cases
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test src/cli/cmd/tui/component/prompt/index.test.tsx
      2. Check output for test results
    Expected Result: All tests pass, 3+ test cases
    Evidence: .sisyphus/evidence/task-4-bun-test.txt
  ```

  **Evidence to Capture:**
  - [ ] bun test output
  - [ ] Test file existence

  **Commit**: YES
  - Message: `test(opencode): add critical tests for prompt/index.tsx`
  - Files: `packages/opencode/src/cli/cmd/tui/component/prompt/index.test.tsx`
  - Pre-commit: `cd packages/opencode && bun typecheck && bun test`

---

- [x] 5. **Split provider/provider.ts (1882→~500 lines each)**

  **What to do**:
  This file has 26 exports + 28 internal helpers. Split into 6 files under `packages/opencode/src/provider/`:

  **NOTE**: `schema.ts` (30 lines), `error.ts` (204 lines), `transform.ts` (1376 lines — still large!) already exist in the provider directory. Sub-steps below describe final desired structure — the executor must work WITH existing files, not create duplicates.

  **Sub-steps (each one commit):**
  
  **5a. Audit existing structure** — Read existing `schema.ts`, `error.ts`, `transform.ts` in provider dir
  - Verify what's already extracted vs still in `provider.ts`
  - Create a checklist of what remains in provider.ts
  
  **5b. Split transform.ts** (1376 lines — a secondary god file!) if needed
  - `transform.ts` may itself need splitting alongside provider.ts extraction
  - Move large helper blocks to `model-transform.ts` or `custom-providers.ts`
  
  **5c. Extract custom-providers.ts** (~725 lines from provider.ts)
  - Move: `BUNDLED_PROVIDERS` record, `custom()` factory function (700+ lines)
  - Merge with any existing custom provider logic in transform.ts
  - Re-export from provider.ts
  
  **5d. Extract util.ts** (~20 lines)
  - Move: `resolveSDK()`, `shouldUseCopilotResponsesApi`, `wrapSSE`, `googleVertexAnthropicBaseURL`
  - Re-export from provider.ts
  
  **5e. Extract model-status.ts** (if not already separate)
  - Move: `toPublicInfo`, `defaultModelIDs`, `fromModelsDevProvider`, `fromModelsDevModel`, `sort`, `parseModel`, `cost()`, `suggestionModelIDs`, `modelSuggestions`
  - Check if transform.ts already has these — if yes, keep as-is
  - Re-export from provider.ts
  
  **5f. Clean up provider.ts** (~650 lines remaining)
  - Remove all re-exports (keep only actual content)
  - Keep: `ProviderService` interface, `Service` class, `use()`, `layer`, `defaultLayer`, `State`
  - Verify no dead imports
  - Check: does `auth.ts` already exist? If so, ensure auth logic is cleaned from provider.ts
  
  **After each sub-step**: `cd packages/opencode && bun typecheck && bun test` MUST pass
  
  **Must NOT do**:
  - Don't refactor `custom()` factory internals — move as-is
  - Don't rename any exports
  - Don't touch test files
  - Don't clean up re-exports until final sub-step

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex multi-step refactoring with strict no-break constraints
  - **Skills**: [`effect`]
    - `effect`: Understands Effect service patterns to ensure correct extraction without breaking service registration

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task) — sequential sub-steps
  - **Parallel Group**: Wave 2 (runs in parallel with Tasks 6, 7, 8)
  - **Blocks**: None (no downstream dependencies on this split order)
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/provider/provider.ts` — Source file
  - `packages/opencode/test/provider/provider.test.ts` — Must pass after each step
  - explore agent analysis showing natural module boundaries (note: some already extracted as schema.ts, error.ts, transform.ts, model-status.ts, auth.ts)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles after each sub-step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
      2. Repeat after 5a, 5b, 5c, 5d, 5e, 5f
    Expected Result: bun typecheck passes clean (zero errors)
    Failure Indicators: Any type error
    Evidence: .sisyphus/evidence/task-5-typecheck-5a.txt (etc per step)

  Scenario: All tests pass after final step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test
    Expected Result: Suite passes (same count as before splitting)
    Failure Indicators: Test count decreases, any test fails
    Evidence: .sisyphus/evidence/task-5-bun-test-final.txt

  Scenario: Public exports unchanged
    Tool: Bash
    Steps:
      1. bun run -e "import * as p from './src/provider/provider'; console.log(Object.keys(p).sort())"
      2. Compare with pre-split export list (captured before first step)
    Expected Result: Same export names (order may differ)
    Evidence: .sisyphus/evidence/task-5-exports.txt

  Scenario: Each module ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/provider/schema.ts src/provider/errors.ts src/provider/custom-providers.ts src/provider/model-transform.ts src/provider/util.ts src/provider/provider.ts
    Expected Result: All ≤ 600 lines
    Evidence: .sisyphus/evidence/task-5-line-counts.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output after each sub-step
  - [ ] Final test output
  - [ ] Export comparison
  - [ ] Line counts

  **Commit**: YES (grouped — one commit per sub-step)
  - Messages: `refactor(provider): extract schema.ts`, `extract errors.ts`, `extract custom-providers.ts`, `extract model-transform.ts`, `extract util.ts`, `chore(provider): clean up re-exports from provider.ts`
  - Pre-commit: `bun typecheck && bun test`

---

- [x] 6. **Split session/prompt.ts (1764→~500 lines each)**

  **What to do**:
  Split into 6 files under `packages/opencode/src/session/`:

  **Sub-steps (each one commit):**
  
  **6a. Extract prompt-schemas.ts** (~70 lines)
  - Move: `PromptInput`, `LoopInput`, `ShellInput`, `CommandInput` schemas, `createStructuredOutputTool`
  - These are at the bottom of the file (lines 1665-1757)
  - Re-export from prompt.ts
  
  **6b. Extract prompt-runloop.ts** (~243 lines)
  - Move: `runLoop` (lines 1239-1482) and `loop` (lines 1484-1488)
  - The cleanest extraction boundary — self-contained loop logic
  - Re-export from prompt.ts
  
  **6c. Extract prompt-createUserMessage.ts** (~520 lines)
  - Move: `createUserMessage` (lines 688-1208)
  - This is the largest internal function — captures context from Effect.gen
  - Must keep as `Effect.gen` block, don't refactor to `Effect.fn`
  - Re-export from prompt.ts
  
  **6d. Extract prompt-handleSubtask.ts** (~191 lines)
  - Move: `handleSubtask` (lines 298-489)
  - Re-export from prompt.ts
  
  **6e. Extract prompt-shellImpl.ts** (~157 lines)
  - Move: `shellImpl` (lines 491-648)
  - Re-export from prompt.ts
  
  **6f. Clean up prompt.ts** (~550 lines remaining)
  - Remove all re-exports
  - Keep: layer, defaultLayer, Interface, `ops`, `cancel`, `resolvePromptParts`, `title`, `getModel`, `currentModel`, `prompt`, `lastAssistant`, `shell`, `command`

  **After each sub-step**: `bun typecheck && bun test` MUST pass

  **Critical**: Internal functions in Effect.gen use captured services via `Effect.gen` context. When extracting to new files, they must import those services directly with `Effect.serviceFromContext` or receive them as parameters. **Do NOT** change the function body — only change how services are obtained.

  **Must NOT do**:
  - Don't convert Effect.gen to Effect.fn
  - Don't change function signatures
  - Don't extract `layer` itself — it stays as the orchestrator

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Effect.gen extraction is the trickiest refactoring — must preserve captured Effect context correctly
  - **Skills**: [`effect`]
    - `effect`: Essential — must understand Effect v4 service context to extract safely

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task)
  - **Parallel Group**: Wave 2 (runs in parallel with Tasks 5, 7, 8)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/session/prompt.ts` — Source file
  - Effect v4 docs: `https://effect.website/docs/` — Effect.fn and service patterns
  - Effect skill file: `.opencode/skills/effect/SKILL.md`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles after each sub-step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
    Expected Result: Clean compile after each of 6a-6f
    Evidence: .sisyphus/evidence/task-6-typecheck.txt

  Scenario: All tests pass
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test
    Expected Result: Full test suite passes
    Evidence: .sisyphus/evidence/task-6-bun-test.txt

  Scenario: Each module ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/session/prompt-*.ts src/session/prompt.ts
    Expected Result: All ≤ 600 lines
    Evidence: .sisyphus/evidence/task-6-line-counts.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output per step
  - [ ] Test output
  - [ ] Line counts

  **Commit**: YES (grouped — one per sub-step)
  - Messages: `refactor(session): extract prompt-schemas.ts`, etc.
  - Pre-commit: `bun typecheck && bun test`

---

- [x] 7. **Split lsp/server.ts (2064→~200+1864 lines)**

  **What to do**:
  Unlike other splits, this file is ~1864 lines of pure data (40 server descriptors) + ~200 lines of active logic. User explicitly chose: **only extract active logic**.

  **Sub-steps (each one commit):**

  **7a. Extract lsp/server-data.ts** (~1864 lines)
  - Move ALL 40 server descriptor objects to `lsp/server-data.ts`
  - Keep in server.ts: Handle interface, `nearestRoot` factory, `spawn`/launch logic, platform helpers
  - Re-export `server-data.ts` from `server.ts`: `export * from "./server-data"`
  
  **7b. Clean up server.ts** (~200 lines)
  - Remove re-exports (keep just the active logic)
  - Keep: Handle interface, `nearestRoot()`, platform-specific Roslyn helpers, and any launch/spawn code

  **After each sub-step**: `bun typecheck && bun test` MUST pass

  **Must NOT do**:
  - Don't group servers into per-language files — user chose not to
  - Don't modify server descriptor content
  - Don't add new server entries

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical data extraction — no logic changes, minimal risk
  - **Skills**: [] (no special skills needed)

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task)
  - **Parallel Group**: Wave 2 (runs in parallel with Tasks 5, 6, 8)
  - **Blocks**: None
  - **Blocked By**: Task 2 (tests must exist before splitting)

  **References**:
  - `packages/opencode/src/lsp/server.ts` — Source file
  - `packages/opencode/src/lsp/server.test.ts` — Must pass after split

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
    Expected Result: Clean compile
    Evidence: .sisyphus/evidence/task-7-typecheck.txt

  Scenario: Server count unchanged
    Tool: Bash
    Steps:
      1. bun run -e "import * as lsp from './src/lsp/server'; console.log('servers:', lsp.servers?.length)"
      2. bun run -e "import * as lsp from './src/lsp/server-data'; console.log('servers:', lsp.servers?.length)"
    Expected Result: Both show same count (40+)
    Evidence: .sisyphus/evidence/task-7-servers.txt

  Scenario: server.ts ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/lsp/server.ts
    Expected Result: ≤ 600 lines
    Evidence: .sisyphus/evidence/task-7-line-count.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output
  - [ ] Server count verification
  - [ ] Line count

  **Commit**: YES
  - Messages: `refactor(lsp): extract server descriptors to server-data.ts`, `chore(lsp): clean up server.ts re-exports`
  - Pre-commit: `bun typecheck && bun test`

---

- [x] 8. **Split acp/agent.ts (1966→~500 lines each)**

  **What to do**:
  Split into 6 files under `packages/opencode/src/acp/`:

  **Sub-steps (each one commit):**

  **8a. Extract agent-helpers.ts** (~150 lines)
  - Move: 16 standalone helper functions (lines 63-130, 1544-1964)
  - These are ALL independent (no `this` access, no class dependency)
  - Functions: `getContextLimit`, `sendUsageUpdate`, `defaultModel`, `lastUsedModel` + 12 sync utilities
  - Re-export from agent.ts

  **8b. Extract agent-events.ts** (~313 lines)
  - Move: `handleEvent` (lines 190-503) — the EventStream handler
  - Also: lifecycle event processing (~505-554)
  - Re-export from agent.ts

  **8c. Extract agent-sessions.ts** (~227 lines)
  - Move: Session CRUD methods (lines 556-783)
  - Re-export from agent.ts

  **8d. Extract agent-message.ts** (~247 lines)
  - Move: `processMessage` (lines 785-1032) — message replay logic
  - Re-export from agent.ts

  **8e. Extract agent-mode.ts** (~112 lines)
  - Move: `loadSessionMode` (lines 1103-1215) and mode resolution helpers
  - Re-export from agent.ts

  **8f. Extract agent-prompt.ts** (~182 lines)
  - Move: `prompt` (lines 1318-1499) and `cancel` methods
  - Re-export from agent.ts

  **8g. Clean up agent.ts** (~300 lines remaining)
  - Remove all re-exports
  - Keep: `Agent` class skeleton, constructor, export list, `init`/`close` lifecycle

  **Critical**: Extracted methods must preserve `this` context. Each extracted file exports a function that takes the necessary state as a parameter, OR the extracted functions are moved as class methods on the same class (by extending or importing). The safest approach: extract pure helper functions first (8a), then extract state-dependent methods as standalone functions that accept Agent state as first parameter.

  **Must NOT do**:
  - Don't change method signatures
  - Don't restructure Agent class hierarchy
  - Don't replace class with service pattern

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex class method extraction with preserved `this` context
  - **Skills**: [`effect`]
    - `effect`: ACP agent uses Effect extensively — must understand service extraction patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task)
  - **Parallel Group**: Wave 2 (runs in parallel with Tasks 5, 6, 7)
  - **Blocks**: None
  - **Blocked By**: Task 1 (tests must exist first)

  **References**:
  - `packages/opencode/src/acp/agent.ts` — Source file
  - `packages/opencode/src/acp/agent.test.ts` — Must pass after each step

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles after each sub-step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
    Expected Result: Clean compile after each of 8a-8g
    Evidence: .sisyphus/evidence/task-8-typecheck.txt

  Scenario: All tests pass (including new tests from Task 1)
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test
    Expected Result: Test suite passes
    Evidence: .sisyphus/evidence/task-8-bun-test.txt

  Scenario: Each module ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/acp/agent*.ts
    Expected Result: All ≤ 600 lines
    Evidence: .sisyphus/evidence/task-8-line-counts.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output per step
  - [ ] Test output
  - [ ] Line counts

  **Commit**: YES (grouped)
  - Messages: `refactor(acp): extract agent-helpers.ts`, `extract agent-events.ts`, `extract agent-sessions.ts`, `extract agent-message.ts`, `extract agent-mode.ts`, `extract agent-prompt.ts`, `chore(acp): clean up agent.ts re-exports`
  - Pre-commit: `bun typecheck && bun test`

---

- [x] 9. **Split session/index.tsx (2343→~500 lines each)**

  **What to do**:
  This is the largest and most complex file — a SolidJS TUI component for the main session view. Split into 12+ files under `packages/opencode/src/cli/cmd/tui/routes/session/`:

  **Sub-steps (each one commit):**

  **9a. Extract session-context.tsx** (~100 lines)
  - Move: Context object creation (lines 156-175), context type definitions, context consumer hook
  - This is used by ALL other components — extract first
  - Re-export from index.tsx

  **9b. Extract components/UserMessage.tsx** (~130 lines)
  - Move: UserMessage component (lines 1296-1400)
  - Pure presentation component — easiest to extract
  - Re-export from index.tsx

  **9c. Extract components/AssistantMessage.tsx** (~90 lines)
  - Move: AssistantMessage component (lines 1402-1491)
  - Re-export from index.tsx

  **9d. Extract components/ReasoningPart.tsx** (with CollapsedReasoningText) (~70 lines)
  - Move: ReasoningPart (lines 1499-1562), CollapsedReasoningText
  - Re-export from index.tsx

  **9e. Extract components/TextPart.tsx** (~80 lines)
  - Move: TextPart component and text rendering helpers
  - Re-export from index.tsx

  **9f. Extract components/ToolPart.tsx** (with GenericTool, InlineTool, BlockTool) (~120 lines)
  - Move: ToolPart dispatcher (lines ~1563-1700), GenericTool, InlineTool, BlockTool
  - Re-export from index.tsx

  **9g. Extract individual tool renderers** (12 files, each ~30-80 lines)
  - One file per tool: Shell, Write, Edit, Glob, Read, Grep, WebFetch, WebSearch, Task, ApplyPatch, TodoWrite, Question, Skill
  - Each: minimal component with tool-specific rendering logic
  - Re-export from index.tsx

  **9h. Extract utils/scroll-helper.ts** (~50 lines)
  - Move: Scroll helper functions (lines 357-408)
  - Re-export from index.tsx

  **9i. Extract utils/command-list.ts** (~500 lines)
  - Move: Command list (30+ createMemo commands, lines 446-1039)
  - This is a large block — extract as-is
  - Re-export from index.tsx

  **9j. Extract components/Diagnostics.tsx** (~50 lines)
  - Move: Diagnostics utility component
  - Re-export from index.tsx

  **9k. Clean up index.tsx** (~500 lines remaining)
  - Remove all re-exports
  - Keep: Main Session component, state signals, lifecycle effects, JSX layout tree

  **Critical**: SolidJS reactivity must be preserved. When extracting components:
  - Pass all state via props (don't create new signal contexts)
  - Don't restructure createMemo chains in command list extraction
  - Keep JSX layout tree structure identical — just delegate to components

  **Must NOT do**:
  - Don't restructure SolidJS reactivity (signals, memos stay as-is)
  - Don't rename any CSS classes or inline styles
  - Don't extract the main Session component itself
  - Don't create new context providers

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: SolidJS component extraction requires understanding of TUI component boundaries
  - **Skills**: [] (no special skills needed)
  - **Skills Evaluated but Omitted**: `effect` — this file doesn't use Effect services directly

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task)
  - **Parallel Group**: Wave 3 (runs in parallel with Task 10)
  - **Blocks**: None
  - **Blocked By**: Task 3 (tests must exist first)

  **References**:
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — Source file
  - `packages/opencode/src/cli/cmd/tui/routes/session/index.test.tsx` — Must pass after each step

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles after each sub-step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
    Expected Result: Clean compile after each of 9a-9k
    Evidence: .sisyphus/evidence/task-9-typecheck.txt

  Scenario: All tests pass
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test
    Expected Result: Test suite passes
    Evidence: .sisyphus/evidence/task-9-bun-test.txt

  Scenario: Each module ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/cli/cmd/tui/routes/session/{index.tsx,components/*,utils/*,session-context.tsx}
    Expected Result: All ≤ 600 lines
    Evidence: .sisyphus/evidence/task-9-line-counts.txt

  Scenario: All tool renderers exist
    Tool: Bash
    Steps:
      1. ls src/cli/cmd/tui/routes/session/components/tool-*.tsx 2>/dev/null | wc -l
    Expected Result: 13+ tool renderer files (Shell, Write, Edit, Glob, Read, Grep, WebFetch, WebSearch, Task, ApplyPatch, TodoWrite, Question, Skill)
    Evidence: .sisyphus/evidence/task-9-tool-files.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output per step
  - [ ] Test output
  - [ ] Line counts
  - [ ] Tool renderer file listing

  **Commit**: YES (grouped)
  - Messages: `refactor(session): extract session-context.tsx`, `refactor(session): extract UserMessage`, ..., `refactor(session): extract tool renderers`, `chore(session): clean up index.tsx re-exports`
  - Pre-commit: `bun typecheck && bun test`

---

- [x] 10. **Split prompt/index.tsx (1676→~500 lines each)**

  **What to do**:
  Split into 6 files under `packages/opencode/src/cli/cmd/tui/component/prompt/`:

  **Sub-steps (each one commit):**

  **10a. Extract prompt-context.tsx** (~80 lines)
  - Move: Context type definitions, context creation, context consumer hook
  - Re-export from index.tsx

  **10b. Extract components/PromptInput.tsx** (~300 lines)
  - Move: Input component, input state handling, key bindings
  - Re-export from index.tsx

  **10c. Extract components/Sidebar.tsx** (~200 lines)
  - Move: Sidebar component, navigation elements
  - Re-export from index.tsx

  **10d. Extract components/Suggestions.tsx** (~200 lines)
  - Move: Suggestion list component, suggestion filtering logic
  - Re-export from index.tsx

  **10e. Extract components/OutputPanel.tsx** (~300 lines)
  - Move: Output/result display component
  - Re-export from index.tsx

  **10f. Extract components/Actions.tsx** (~200 lines)
  - Move: Action buttons, command dispatchers
  - Re-export from index.tsx

  **10g. Clean up index.tsx** (~300 lines remaining)
  - Remove all re-exports
  - Keep: Main Prompt component, layout composition, top-level state signals

  **After each sub-step**: `bun typecheck && bun test` MUST pass

  **Must NOT do**:
  - Don't restructure SolidJS reactivity
  - Don't rename CSS classes
  - Don't modify the main component's signal wiring

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: TUI component extraction with SolidJS reactivity
  - **Skills**: [] (no special skills)
  - **Skills Evaluated but Omitted**: `effect` — not an Effect-based component

  **Parallelization**:
  - **Can Run In Parallel**: NO (within task)
  - **Parallel Group**: Wave 3 (runs in parallel with Task 9)
  - **Blocks**: None
  - **Blocked By**: Task 4 (tests must exist first)

  **References**:
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` — Source file
  - `packages/opencode/src/cli/cmd/tui/component/prompt/index.test.tsx` — Must pass after each step

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**
  ```
  Scenario: TypeScript compiles after each sub-step
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun typecheck
    Expected Result: Clean compile after each step
    Evidence: .sisyphus/evidence/task-10-typecheck.txt

  Scenario: All tests pass
    Tool: Bash
    Steps:
      1. cd packages/opencode && bun test
    Expected Result: Full test suite passes
    Evidence: .sisyphus/evidence/task-10-bun-test.txt

  Scenario: Each module ≤ 600 lines
    Tool: Bash
    Steps:
      1. wc -l src/cli/cmd/tui/component/prompt/{index.tsx,components/*,prompt-context.tsx}
    Expected Result: All ≤ 600 lines
    Evidence: .sisyphus/evidence/task-10-line-counts.txt
  ```

  **Evidence to Capture:**
  - [ ] typecheck output per step
  - [ ] Test output
  - [ ] Line counts

  **Commit**: YES (grouped)
  - Messages: `refactor(prompt): extract prompt-context.tsx`, `refactor(prompt): extract PromptInput`, ..., `chore(prompt): clean up index.tsx re-exports`
  - Pre-commit: `bun typecheck && bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (grepping for files, checking exports). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cd packages/opencode && bun typecheck && bun test`. Review all changed files for: `any`/`@ts-ignore`, circular imports (grep for import cycle patterns), dead re-exports. Check AI slop: excessive comments, over-abstraction.
  Output: `Typecheck [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Execute EVERY QA scenario from EVERY task — verify TypeScript compiles, test suite passes, exports are unchanged. Verify cross-file integration. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Creep [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1**: `test(opencode): add critical tests for acp/agent.ts`
- **T2**: `test(opencode): add critical tests for lsp/server.ts`
- **T3**: `test(opencode): add critical tests for session/index.tsx`
- **T4**: `test(opencode): add critical tests for prompt/index.tsx`
- **T5**: Grouped commits: `refactor(provider): extract schema.ts`, `refactor(provider): extract errors.ts`, etc.
- **T6**: Grouped commits: `refactor(session): extract prompt schemas`, etc.
- **T7**: `refactor(lsp): extract active logic from server.ts`
- **T8**: Grouped commits: `refactor(acp): extract agent-events.ts`, etc.
- **T9**: Grouped commits: `refactor(session): extract message components`, etc.
- **T10**: Grouped commits: `refactor(prompt): extract prompt context`, etc.
- **Cleanup**: `chore: remove temporary re-exports after giant file splitting`

---

## Success Criteria

### Verification Commands
```bash
cd packages/opencode && bun typecheck
cd packages/opencode && bun test
```

### Final Checklist
- [x] All 6 files reduced to <600 lines each
- [x] bun typecheck passes
- [x] bun test passes (all tests, pre-existing failures only)
- [x] No new `any` types
- [x] No circular dependencies
- [x] Temporary re-exports cleaned up
- [x] All new modules have ≤600 lines
- [x] Original public API surface unchanged
