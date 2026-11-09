# 0026 Production waits for CI

**Date:** 6 November 2026, amended 7 November 2026. **Status:** accepted (Rory, Sprint 9 Q6; F-23). The amendment records the gate Rory put in place on 6 November (pull request #2), which replaced the Vercel setting first chosen here.

**Context.** Vercel deployed every push to `main` to production as soon as it built. CI ran at the same time, so a failure was reported but couldn't stop the deploy. On 6 November a README merge went live while CI's Neon job had been cancelled, which is the case this item exists for.

**Decision (amended 7 November).** The gate is on GitHub. The repository is public, so GitHub enforces rulesets on this plan, and the ruleset **Protect main** (active, nobody can bypass it) allows changes to `main` only through a pull request whose three CI checks pass on its latest commit, with the branch up to date with `main`:
- `Typecheck, lint, unit and database tests, build`
- `End-to-end (app, Inngest dev server, mock model)`
- `Migrations and database tests on a Neon branch`

It also refuses force pushes to `main` and its deletion. Every commit that reaches `main`, and so every production deploy, has already passed CI.

**First choice, replaced.** Vercel's Deployment Checks, holding each production deployment until the three jobs pass on its commit. It is not needed with the ruleset, which stops an unchecked commit before it reaches `main` rather than after.

**What changed in the repo.**
- `ci.yml`: the Neon job's concurrency group gives `main` its own lane, so a branch push can't cancel `main`'s run of a required check.
- `after-deploy.yml`: starts when CI completes successfully on a push to `main` (`workflow_run`), not at the push.
- `docs/hosting.md`, Vercel step 5: describes the ruleset and the emergency route.

**Evidence (F-23).**
- Case 1, 7 November 2026: GitHub refused to merge pull request #3 (Sprint 9) twice while its checks ran. At 15:57 UTC: "3 of 3 required status checks have not succeeded" (HTTP 405). At 17:08 UTC, with the push run's Neon check still in progress: "Required status check "Migrations and database tests on a Neon branch" is in progress" (HTTP 405). It merged at 17:26:16 UTC, once all three had passed.
- Case 2: production deployment `dpl_DiSieiSFpaQV7whHGTN9A5kzd8K5` was ready at 17:27:30 UTC, 74 seconds after the merge, and `/api/health` reported commit `94b9781`.

**Emergency route.** Instant Rollback in Vercel to an earlier deployment. A fix still goes through a pull request.

**Rejected.** The deploy-hook fallback (`git.deploymentEnabled` off for `main`, and CI's last job calling a hook) works on any plan but adds a secret and moves the deploy trigger into CI.

**Consequences.** A change reaches the live site about 40 minutes after its last push, once CI has passed, and a few minutes after the merge. A branch behind `main` merges `main` in and passes CI again first. Sign-off and the merge approval (decision 0021) are unchanged.
