# 0005 The image model never draws text

**Date:** 24 October 2026. **Status:** accepted; enforced from Sprint 5.

**Context.** Image models still misspell words and drift from brand fonts and logos.

**Decision.** Image models generate imagery only. Headlines, body copy, calls to action, logos and legal lines are composed over the image in code (HTML templates rendered to images), using the brand kit.

**Consequences.** Every variant is on-brand and legible by construction, and compliance checks can focus on judgement calls such as imagery and claims.
