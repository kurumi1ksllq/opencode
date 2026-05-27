# Issues Found During F3 QA

## Critical Issues

### 1. prompt/index.tsx exceeds 600 line limit (1201 lines)
- **File**: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`
- **Lines**: 1201 (limit: 600)
- **Impact**: File is nearly double the target limit
- **Note**: A `components/` subdirectory already exists with extracted files (Actions.tsx, etc.), but the main index file is still too large
- **Recommendation**: Further split the index file — extract additional components or utilities

### 2. lsp/server-data.ts is large (1830 lines)
- **File**: `packages/opencode/src/lsp/server-data.ts`
- **Lines**: 1830 (created during server.ts split)
- **Note**: This is the extracted code from the original server.ts (which is now a 1-line re-export)
- **Recommendation**: Consider further splitting in a follow-up task

## Non-Critical Issues

### 3. Full test suite has pre-existing failures
- **Files**: `test/file/path-traversal.test.ts`, `test/session/compaction.test.ts`, `test/session/prompt.test.ts`
- **Root Cause**: Windows path handling (/etc/passwd on Windows) and flaky timing tests
- **Impact**: None on the splitting project — these are pre-existing
