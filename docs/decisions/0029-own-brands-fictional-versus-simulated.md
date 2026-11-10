# 0029 Rule 2 reworded: a person's own brand may be real; fictional and simulated are separate

- **Date:** 10 November 2026
- **Decided by:** Rory (product manager), answer A1 in `docs/refinement/sprint-10b.md`; recorded by Claude as lead engineer

## Context

Rule 2 said "Fictional brands only": no real company names, logos or trademarks anywhere in Studio. Sprint 10b lets a person add a brand of their own from the Brands page (D-1), and the demo on 11 November uses a real brand. The rule as written would forbid that.

The database also used one flag, `brands.is_simulated`, for two things: "this brand is invented" and "this brand's data is simulated". The "Demo brand" pill and the launch pack README ("The brand in this pack is fictional.") read it. A real brand with generated customers (D-3) would have been labelled fictional, which is untrue (rule 1).

And the brief, copy, translation and upload checks refuse any company the market notes name, except the brand's own name. A brand that is part of a parent brand (Rory's answer A2) would be refused for naming its parent.

## Decision

1. **Rule 2 in CLAUDE.md now reads:** "Fictional brands in seeds, demo data, tests, evals and screenshots. A person may add their own real brand to their own workspace; a real brand's logo is used only with its owner's permission. Market notes may name real companies with their sources; those names never reach a brief or creative unless they are the brand's own names."
2. **Two flags, one meaning each.** `brands.is_fictional` (new, default false) says the brand is invented; the migration sets it for the existing demo brands, and it never changes after a brand is made. `brands.is_simulated` says only that the brand's data is simulated; it may become true when simulated data is generated (D-3) and never goes back. "Demo brand" and the launch pack's "fictional" sentence read `is_fictional`; "Simulated data" reads `is_simulated`.
3. **A brand's own names.** `brands.own_names` holds up to 5 other names the brand's ads may use, such as a parent brand's ("Also known as" in the kit editor). The checks treat them like the brand's name. Any other company the market notes name is still refused. The imagery prompt still takes out the brand's name and its own names (rule 8 unchanged).
4. **The Market agent** searches about the category and its customers for a fictional brand, as before. For a real brand it may also search about the brand itself and its own names.

## Consequences

- The seeds, demo data, fixtures, tests, evals and screenshots stay fictional, and `tests/lib/fictional-names.test.ts` scans them for real company names in CI.
- A person's real brand can be named in its own briefs and ads, and its data is still labelled as simulated wherever it is shown.
- Logos: Studio does not check permission. Uploading a real brand's logo is the person's responsibility, which the rule now states.
- A real parent and child brand with an inherited kit is not built; it is on the backlog.
