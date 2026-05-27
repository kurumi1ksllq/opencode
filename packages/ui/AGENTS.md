# UI Package

This package provides the frontend component library. It uses SolidJS with Kobalte primitives and a CSS-layer-based visual architecture.

## Framework

- Built with **SolidJS** (not React, not Vue)
- Uses **@kobalte/core** for accessible primitives (button, dialog, popover, select, tabs, tooltip, etc.)
- SolidJS patterns: `createSignal`, `createMemo`, `createEffect`, `splitProps`
- Prefer `createStore` over multiple `createSignal` calls (see [packages/app/AGENTS.md](../app/AGENTS.md))

## Component Pattern

Every component follows this structure:

```tsx
import { Button as Kobalte } from "@kobalte/core/button"
import { type ComponentProps, Show, splitProps } from "solid-js"

export interface ButtonProps
  extends ComponentProps<typeof Kobalte>,
    Pick<ComponentProps<"button">, "class" | "classList" | "children"> {
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
  icon?: IconProps["name"]
}

export function Button(props: ButtonProps) {
  const [split, rest] = splitProps(props, ["variant", "size", "icon", "class", "classList"])
  return (
    <Kobalte
      {...rest}
      data-component="button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "secondary"}
      classList={{ ...split.classList, [split.class ?? ""]: !!split.class }}
    >
      <Show when={split.icon}>
        <Icon name={split.icon!} size="small" />
      </Show>
      {props.children}
    </Kobalte>
  )
}
```

Key rules:

- **Wrap a Kobalte primitive** — import with `as Kobalte` alias, pass through `{...rest}`
- **`splitProps`** — separate component-specific props from passthrough Kobalte props
- **`data-component` attribute** — every component sets `data-component="<name>"` for CSS targeting
- **`data-size` / `data-variant`** — use data attributes for visual variants, not class names
- **CSS co-located** — each component has a `.css` file in the same directory

## CSS Architecture

All styles are organized into CSS layers, defined in `src/styles/index.css`:

```css
@layer theme, base, components, utilities;
```

- **theme** — CSS custom properties (`--text-strong`, `--surface-base`, etc.) from `colors.css` and `theme.css`
- **base** — resets, global defaults, katex styles
- **components** — per-component CSS files imported from `src/components/*.css`
- **utilities** — utility classes, animations, Tailwind utilities

Components use attribute selector targeting, not class name selectors:

```css
[data-component="button"] {
  &[data-variant="primary"] { ... }
  &[data-size="small"] { ... }
}
```

There is minimal Tailwind usage in component CSS. Tailwind (`tailwind.css`) is only used in `styles/tailwind/` for the Tailwind-v4-generated utility layer. Do not add Tailwind classes to component CSS files.

## V2 Components

Production components live in `src/v2/components/` (named `button-v2.tsx`, `accordion-v2.tsx`, etc.). The legacy `src/components/` directory contains v1 versions. **Prefer creating v2 components** for new work.

- V2 components follow the same Kobalte + splitProps + data-component pattern
- CSS files are named `button-v2.css`, co-located with the component
- V2 styles (separate CSS layer) are in `src/v2/styles/`
- V2 exports are accessed via `@opencode-ai/ui/v2/*`

## Theming

The theme system (`src/theme/`) generates CSS custom properties from seed colors or palette definitions:

- `types.ts` — `ThemeSeedColors`, `ThemePaletteColors`, `ThemeVariant`, `DesktopTheme`, `ThemeToken`
- `color.ts` — Oklch color space utilities
- `context.tsx` — SolidJS context provider
- `resolve.ts` — resolves seed colors to CSS variable maps
- `loader.ts` — loads themes from JSON files or schema validation
- `default-themes.ts` — built-in light/dark themes
- `themes/` — directory for custom theme JSON files

Theme tokens resolve to `var(--<token>)` CSS custom properties consumed by component styles.

## Icons

Three icon sets with typed names:

- `src/components/icons/` (exported via `@opencode-ai/ui/icons/*`)
- `src/components/provider-icons/types.ts` — provider logos (`@opencode-ai/ui/icons/provider`)
- `src/components/file-icons/types.ts` — file type icons (`@opencode-ai/ui/icons/file-type`)
- `src/components/app-icons/types.ts` — app icons (`@opencode-ai/ui/icons/app`)

Icons are rendered via the `<Icon name="..." />` component in `src/components/icon.tsx`.

## i18n

Locale files in `src/i18n/` (18 languages: en, zh, ja, ko, ar, br, bs, da, de, es, fr, no, pl, ru, th, tr, uk, zht). Accessed via `@opencode-ai/ui/i18n/*`.

## Exports

The `package.json` `"exports"` field configures the public API surface:

- `@opencode-ai/ui/<ComponentName>` — component modules (from `src/components/*.tsx`)
- `@opencode-ai/ui/styles` — CSS entry point (`src/styles/index.css`)
- `@opencode-ai/ui/styles/tailwind` — Tailwind utility CSS
- `@opencode-ai/ui/theme` / `@opencode-ai/ui/theme/*` — theme system
- `@opencode-ai/ui/hooks` — shared hooks (`create-auto-scroll`, `use-filtered-list`)
- `@opencode-ai/ui/context` — SolidJS context providers
- `@opencode-ai/ui/i18n/*` — locale files
- `@opencode-ai/ui/pierre` / `@opencode-ai/ui/pierre/*` — Pierre diff system
- `@opencode-ai/ui/v2/*` — v2 components
- `@opencode-ai/ui/fonts/*` — font assets
- `@opencode-ai/ui/audio/*` — audio assets

## Stories

Components have co-located `.stories.tsx` files for Storybook (e.g. `button.stories.tsx`). The `src/storybook/` directory contains shared storybook infrastructure.

## Tests

- Run: `bun test src` from `packages/ui`
- Test files co-locate with source (`.test.ts`, `.test.tsx`)
- Component tests use standard SolidJS testing patterns
