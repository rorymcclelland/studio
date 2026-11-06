# 0026 Production waits for CI

**Date:** 6 November 2026. **Status:** accepted (Rory, Sprint 9 Q6; F-23).

**Context.** Vercel deployed every push to `main` to production as soon as it built. CI ran at the same time, so a failure was reported but couldn't stop the deploy. On 6 November a README merge went live while CI's Neon job had been cancelled, which is the case this item exists for. The repository is now public, so GitHub could require checks on pull requests, but that only guards merges through a pull request: Vercel still deploys whatever reaches `main`.

**Decision.** Vercel's Deployment Checks (available on every plan, including Hobby) hold each production deployment until CI's three jobs pass on its commit:
- `Typecheck, lint, unit and database tests, build`
- `End-to-end (app, Inngest dev server, mock model)`
- `Migrations and database tests on a Neon branch`

Each is marked Required in the project's settings (`docs/hosting.md`, Vercel step 5). Rory turns this on; it is a project setting, not code.

**What changed in the repo.**
- `ci.yml`: the Neon job's concurrency group gives `main` its own lane. GitHub keeps one waiting run per group and cancels the others, which is how 6 November's main run lost its Neon job to a branch push. With the job required, that would hold production indefinitely.
- `after-deploy.yml`: starts when CI completes successfully on a push to `main` (`workflow_run`), not at the push, so its 15-minute wait for the new commit begins once the deployment can actually be promoted.

**Emergency route.** Promote the held deployment by hand in Vercel (**⋯ → Promote**), or use Instant Rollback, and say so in the next commit.

**Rejected.** The deploy-hook fallback (`git.deploymentEnabled` off for `main`, and CI's last job calling a hook) works on any plan but adds a secret and moves the deploy trigger into CI. It stays the fallback if Deployment Checks stop working for this project.

**Consequences.** A merge reaches the live site about 40 minutes later than before, once CI has run. A failed or cancelled CI leaves the previous deployment live, so a re-run of CI is the way to release a commit held by a flaky job. Sign-off and the merge approval (decision 0021) are unchanged.
