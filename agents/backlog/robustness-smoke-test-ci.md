---
stream: robustness
priority: 2
status: blocked
blocked: owner — may CI run the browser smoke test? It changes `.github/workflows/ci.yml`, which agents do not merge. The lines are below.
added: 2026-11-22
needs: [robustness-smoke-test]
---
# Run the browser smoke test in CI

Why: `npm run smoke` (PR #32) catches a shader that does not compile, a missing data file or a module that throws, but only when someone runs it. In CI it would stop such a PR before it reaches the live site.

Done when: the `web` job of `.github/workflows/ci.yml` runs the smoke test after the build, and it has passed on three PRs in a row without a false alarm.

Notes:
- Add one step at the end of the `web` job, after `- run: npm run build`:

  ```yaml
        - run: npm run smoke
  ```

- GitHub's `ubuntu-latest` runners ship Google Chrome, and the job already uses Node 22, so nothing else is installed. The script passes `--no-sandbox` to Chrome when `CI` is set on Linux.
- Not tried on a Linux runner yet: the script has only run on this Windows PC. If software WebGL is slow there, raise `--timeout`; if Chrome is not found, set `CHROME` to its path.
- Messages about other sites (IGN tiles, Google Fonts) do not fail the test, so a runner without access to them still passes.
- An agent can open the PR for the owner to merge if the owner says so here.
