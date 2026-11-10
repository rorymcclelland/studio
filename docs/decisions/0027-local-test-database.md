# 0027 Local test database: start it fresh before each long run

- **Date:** 9 November 2026
- **Decided by:** Rory (product manager), on Claude's recommendation as lead engineer

## Context

The pre-commit check runs the full Vitest suite (about 1,100 tests, about 10 minutes) against a local Postgres. In Claude's cloud workspace that Postgres runs as a background job, and the workspace stops background jobs after two hours at most. Detached processes are stopped sooner. On 9 November it stopped twice partway through work, which failed test runs for reasons unrelated to the code and held up U10-3.

Options considered:

1. Check only in CI after each push. Reliable, but each round takes 30 to 45 minutes and problems are found only after the work is on the sprint branch.
2. Run local tests against a Neon test branch. Never stops, but tests are slower over the network, it needs a connection string set up by Rory, and it costs some Neon compute.
3. Keep the local database, and start it fresh before each long run, so every run has a full two hours.

## Decision

Option 3. Claude starts the local test database fresh before each long run (a full test suite, a full browser-test run, or a commit). CI stays the final gate before `main`, as decision 0026 sets out. If the local database still fails partway through a run, the commit may go without the local check, with CI doing the checking, and Claude tells Rory when that happens (as for U10-3, commit 6f6a64e). If it keeps failing, option 2 is the fallback, and Rory sets up the credential.

## Consequences

- Fast local results (about 10 minutes) remain the normal loop.
- Nothing reaches production without CI's three checks, whichever way the work is checked.
