# 0008 Brand screens: how the editor guards drafts, and how e2e specs share the demo brands

**Date:** 25 October 2026. **Status:** accepted (built in S2-3, S2-4 and S2-5).

**Context.** S2-3 asks that leaving the brand editor with unsaved changes asks first, and that saved changes do not. The App Router has no navigation-blocking API. With Cache Components on, a page you leave is kept hidden (React Activity, up to three routes), so its state, including a draft, survives a later visit. Separately, S2-4 #5 needs an empty workspace, while other e2e specs read the demo brands at the same time.

**Decision.**
- `useLeaveGuard` (`src/components/use-leave-guard.ts`) covers the three ways out. For tab close, reload and other sites it uses `beforeunload`. For in-app links it uses a capture-phase click listener on `window`, which runs before the router's handling and asks with `confirm()`. For the back button, while there are changes it adds one extra history entry for the same address, so the first back lands on this page and is asked about. Saving leaves through `leaveTo()`, which first takes the extra entry away, so history stays as if there were no guard.
- The editor resets its draft when its page is hidden: leaving means the draft was saved or discarded. It also takes a newer kit from the server whenever it has no draft to lose. Unsaved means the draft differs from the saved kit once spaces at the ends are trimmed and key order is ignored (Postgres `jsonb` returns palette colours as `{hex, name}`).
- The editor does not change the logo (upload arrives with imagery, Sprint 5); the save action keeps the stored one.
- The context search keeps its query in the address (`?q=`, `next/form`), so a search can be shared and back returns to the last one.
- e2e: S2-4 #5 runs in a Playwright setup project (`tests/e2e/demo-brands.setup.ts`). It empties the dev workspace, adds the demo brands through the UI, presses the button again, and leaves the brands loaded for every other spec. Specs only read Fernhollow; only `brands.spec.ts` saves edits, and only to Quillmoor. So the layout, contrast and dark-system loops can compare Fernhollow's screens between visits.

**Consequences.** A sign-out or other non-link navigation from a dirty editor is not guarded; it is rare and loses only the draft. If more editors arrive, they reuse `useLeaveGuard`. Running a single e2e spec still runs the setup project first, which reloads the demo brands.
