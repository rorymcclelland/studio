# 0007 Design system: two-layer tokens, light theme only

**Date:** 25 October 2026. **Status:** accepted (Sprint 2 refinement, Q7; built in S2-1).

**Context.** Decision 0006 chose Soft machine. The Sprint 1 app used a neutral shell that followed the operating system's dark setting; the prototype had its own light and dark palettes in a CSS module that the app could not share.

**Decision.**
- Tokens live in `src/app/globals.css` in two layers: theme tokens (CSS custom properties on `:root`, the Soft machine light palette) and Tailwind theme names (`@theme inline`: `bg`, `surface`, `ink`, `primary`, `good`/`review`/`attention` with `-soft` and `-ink` variants, radii, the display and title type sizes). Components use only the Tailwind names, never hex values.
- Light theme only. The app ignores the system dark setting: no `prefers-color-scheme` rules, `color-scheme: only light` and the matching `<meta name="color-scheme">` from the root layout's `viewport`, so browsers do not darken the page themselves.
- Components live in `src/components/ui/` (Button, Card, Pill, Field, Input, Textarea, Select, SegmentedNav, Ring, EmptyState, Skeleton, Toast, Wordmark). `/design` shows every one with labelled sample values and is the screenshot reference.
- Motion is opt-in: the ring and toast animations sit inside `prefers-reduced-motion: no-preference`, and a global rule removes any other animation under reduced motion.
- Figtree is loaded once, from the root layout (`@fontsource-variable/figtree`, now a runtime dependency). Prototypes A and B and their fonts are removed (F-6); C stays at `/directions/soft-machine` as reference until Sprint 3.

**Consequences.** The dark theme (F-9) is a second block of theme tokens under a selector such as `:root[data-theme="dark"]`, plus a toggle; no component changes. Until then the e2e suite checks that a dark operating system gets an identical light screen (`tests/e2e/design-system.spec.ts`, S2-1 #3).
