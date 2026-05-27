# Learnings - Prompt Component Refactor

## Extraction Pattern
- Use `as any` casts for complex deps objects to avoid type compatibility issues with extracted functions
- For JSX files, use `.tsx` extension (not `.ts`) even for utility modules that contain JSX
- Extract pure helper functions first (easiest, no deps needed)
- For helper functions that need component state, use a deps object pattern (like `ActionDeps`)

## Files Created
- `editor-context-format.ts` - Pure editor helper functions (hasEditorRangeSelection, getEditorRangeLabel, formatEditorContext)
- `prompt-utils.ts` - Paste/clear/extmark helpers with PromptUtilsDeps pattern
- `workspace.ts` - Workspace-related functions with WorkspaceDeps pattern
- `compute.ts` - Pure computation functions for memos (highlight, usage, etc.)
- `commands.ts` - Command builders for useBindings blocks
- `submit.tsx` - Full submit/submitInner logic extracted

## Key Pattern
When extracting functions that use component-scoped variables (signals, stores, hooks), create a deps type and pass a deps object. Keep signal/memo/createEffect in index.tsx and only extract presentation components and pure helpers.

## AST-Grep Warning
ast_grep_replace with `$$$` in replacement can corrupt function bodies. Always verify replacements.
