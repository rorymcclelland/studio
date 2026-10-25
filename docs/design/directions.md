# Sprint 1 design directions

Three prototypes at `/directions`, each showing the same two screens (campaign home and creative review) with the same sample data for the fictional brand Fernhollow Outfitters. All three work at phone and desktop widths, in light and dark, and pass automated AA contrast checks.

| | A. Press check | B. Control desk | C. Soft machine |
|---|---|---|---|
| Idea | A print studio's proofing desk: white sheet, crop marks, colour bars, sign-off stamps | A broadcast gallery: dense panels, status lights, a day-by-day rundown of every variant | Calm and light: one plain sentence, a health ring, soft forms |
| Type | Fraunces headlines, Instrument Sans text | IBM Plex Sans Condensed, tabular figures | Figtree throughout |
| Colour | Paper and ink, CMYK accents | Dark teal, green, amber and red signals | Pale lavender ground, indigo accent |
| Voice | "Sign off", "Send back", "Press notes" | "Approve", "Decline", "Needs you" | "Approve", "Not now", "Waiting for your OK" |
| Strongest on | Creative review and approvals | Performance and the self-healing loop | First-time users, executives, phones |
| Watch out for | The print metaphor has to stretch to live data | Dense; less welcoming for a first-time user | Less detail per screen for analysts |

**Choice (25 October 2026):** C. Soft machine, recorded in decision 0006. Sprint 2 builds the design system from it.

**Sprint 2 (S2-1, F-6):** A and B and their fonts were removed; they remain in git history before this change. C stays at `/directions/soft-machine` as the reference until Sprint 3. The design system itself is described in decision 0007 and shown at `/design`.
