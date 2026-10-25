# 0006 Design direction: Soft machine

**Date:** 25 October 2026. **Status:** accepted (Rory).

**Context.** Sprint 1 built three design-direction prototypes on the same two screens and sample data: A. Press check, B. Control desk and C. Soft machine (see `docs/design/directions.md`).

**Decision.** Studio uses direction C, Soft machine: light and calm, generous space, rounded forms and gentle motion, Figtree throughout, a pale lavender ground with an indigo accent. A home screen leads with one plain sentence about how the campaign is doing and a health ring for healthy spend share. The copy voice is "Approve", "Not now" and "Waiting for your OK".

**Consequences.** Sprint 2 builds the design system (tokens, core components, light and dark themes) from `src/app/directions/soft-machine/`. The watch-out from the prototype stands: Soft machine carries less detail per screen, so the Performance screens (Sprints 8 and 9) need a deliberate way to reveal detail, such as expandable rows or a detail drawer, rather than density. Prototypes A and B stay in the repo as reference until Sprint 2 removes them.
