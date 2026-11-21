# The agent program

Scheduled Claude sessions improve Rue par Rue on their own, one workstream each, on this PC. Each run finishes or advances one backlog item, ships it as a pull request, merges it when CI passes, and leaves the backlog ready for the next run. Read [CLAUDE.md](../CLAUDE.md) first: its standing rules apply to every run.

## Workstreams

| Stream | Goal | Measured by |
| --- | --- | --- |
| `photos` | Place more archive photos, more precisely, facing the right way (README roadmap, phase 3) | photos placed out of those harvested, median confidence, photos with a heading, wrong placements in a random sample of 20 |
| `cite1836` | The Île de la Cité as it stood in 1836: real footprints, addresses, shop names, roofs | Vasserot sheets traced (57 of 169 on 2026-11-20), median IoU, buildings drawn from a source rather than estimated |
| `quarters` | Take the detailed 3D model beyond the Cité, one quarter at a time | quarters in 3D, buildings, data size, frame time on this PC and a phone-sized viewport |
| `robustness` | Fast and reliable everywhere, Windows Chrome and phones first | FXC compile time per shader, time to first 3D frame, GPU memory, bundle size, test count |
| `era1920` | The Cité of 1900–1929 with facades from its dated photos: the photo where a wall was photographed, a facade generated from the photos of the same street where it was not, each labelled (README roadmap, phase 5) | photos of the era with a full camera pose, walls with a photo, walls generated, walls still drawn by rule, texture download size and GPU memory |

Each scheduled task names its stream. Work only on items of your stream.

## One run

### 0. Set up

1. The repository is `C:\Users\brgau\Projects\rue-par-rue` (GitHub: `benjamin-gaultier/rue-par-rue`). Run `git fetch origin --prune`.
2. If the main checkout is on `main` with a clean working tree, bring it up to date: `git -C C:\Users\brgau\Projects\rue-par-rue pull --ff-only`. Never commit, switch branches or edit files in the main checkout.
3. Work in a worktree of your own: `C:\Users\brgau\Projects\rue-par-rue\.claude\worktrees\agent-<stream>`. If the session offers the EnterWorktree tool, use it with that name. Otherwise create it once with `git worktree add .claude/worktrees/agent-<stream> --detach origin/main` and reuse it on later runs. Use absolute paths inside it.
4. First run in a worktree: `cd web && npm ci`; `cd pipeline && python -m venv .venv && .venv\Scripts\python -m pip install -e ".[dev,geo]"`. Later runs: `npm ci` again only when `web/package-lock.json` changed.

### 1. Finish what is open before starting anything new

List your stream's open PRs: `gh pr list --state open --json number,title,headRefName,isDraft,url` and keep those whose branch starts with `claude/agent-<stream>-`. A stream has at most one open PR. If there is one, this run is about it: check out its branch, read its description and every comment (a comment from the repository owner overrides this file), finish the work, fix CI, update it on main, and merge it under the rules below. Start a new item only once it is merged or handed to the owner.

Also handle any item in your stream that names an existing PR (for example `photos-land-pr12-pr14`) before other work.

Leave alone every PR whose branch you did not create, unless a backlog item hands it to you: other sessions may be working on it.

### 2. Pick an item

Read `agents/backlog/*.md` on `origin/main`. Candidates are files with `stream: <yours>` and `status: open` whose `needs:` items are all `done`. Take the lowest `priority` number, then the oldest `added`.

No candidate left? Groom instead: read the README roadmap, the code and the data, and write two to four new items for your stream (format below). Ship them as a PR of their own that changes only `agents/backlog/`, merge it on green CI, and end the run.

### 3. Branch and claim

`git switch -c claude/agent-<stream>-<slug> origin/main`, where `<slug>` is the item's file name without the stream prefix and `.md`. After the first commit, push and open a draft PR at once, which claims the item:

```sh
git push -u origin claude/agent-<stream>-<slug>
gh pr create --draft --base main --title "<what it does, in plain words>" --body "Backlog: agents/backlog/<file>.md …"
```

### 4. Do the work

- One item per run, about two hours of work. If an item is bigger, do the first useful slice, and write the rest as new items.
- Measure before and after with the stream's numbers. Spot-check data changes by hand (open 10 to 20 changed records and compare them with their source).
- Add tests for new logic. Update the README where the numbers or commands it gives change.
- Web changes: run the app from your worktree in the background on your stream's port, so the streams never clash (`npm run dev -- --host 127.0.0.1 --port <port> --strictPort`; photos 5174, cite1836 5175, quarters 5176, robustness 5177, era1920 5178), and look at the change in a browser when a browser tool is available (open `http://127.0.0.1:<port>`). Stop the server before the run ends. For anything 3D, open the Île de la Cité in 3D at 1790, 1836, 1900 and today, walk the streets, and check there is no "could not be drawn" message and no console error. If you could not look, say so in the PR.
- In the same PR, set the item's `status: done` with a `done:` line (date, PR number, one-line result), and add new items for the follow-ups you found.

### 5. Check

Run the checks in CLAUDE.md for each side you touched (both if in doubt). Shader changes: also measure compile times with `tools/fxc/` and give them in the PR.

### 6. Ship

1. Push, then `gh pr ready <n>`. Give the PR body: what changed, before → after numbers, how you checked it, the commands that regenerate any generated data it touches, and what is left.
2. Wait for CI: `gh pr checks <n> --watch`. On failure, fix and push. After three failed attempts, turn the PR back to draft, write what you tried in a comment, and end the run.
3. Merge under the rules below. After the merge, `gh run list --workflow pages.yml --limit 1` should show the deploy starting; no need to wait for it.

### 7. Report

End the run with this message, so the person who reads the run list sees the state at a glance:

```
Stream: <stream>   Item: <slug>   PR: #<n> merged | #<n> open (why) | none
Result: one or two sentences, with before → after numbers.
Next: the item the next run will take.
Needs the owner: what and why, or "nothing".
```

## Merging

Merge your own PR with `gh pr merge <n> --merge` only when all of these hold:

- its branch starts with `claude/agent-<stream>-` and was created by this program, or a backlog item names the PR and hands it to you;
- every CI check passed and GitHub reports no conflict;
- it is up to date with main if it touches generated data (next section);
- it changes nothing under `.github/` or `.claude/`, and not `LICENSE`, `CLAUDE.md` or `agents/PROGRAM.md`;
- it does not lower a headline number (photos placed, sheets traced, tests) or remove a source without a reason stated in the PR;
- the owner has left no unanswered comment.

After merging, tidy up: `git switch --detach origin/main` (after a fetch), `git branch -D <branch>`, `git push origin --delete <branch>`.

Otherwise mark it ready for review, comment why it waits for the owner, and say so in the report. Never use `--admin`, never push to `main`, never force-push a branch other sessions may have checked out.

## Generated data

Two PRs that both rewrite `web/public/data/photos.geojson`, `manifest.json`, the thumbnails, `web/public/data/3d/` or `pipeline/cache/` cannot both merge cleanly. So:

- Regenerate shared data only at the end, right before merging, on top of the latest main: `git fetch origin && git merge origin/main`. On a conflict in a generated file, take main's version (`git checkout origin/main -- <file>`) and run the commands that build it again. Then rerun the checks, push, wait for CI and merge at once.
- List those commands in the PR body, so any run can rebuild the data. The usual ones: `python -m rpr parismusees --offline` then `python -m rpr index` (photos), `python -m rpr thumbs --area cite` (thumbnails), `python -m rpr model3d --area cite`, `site`, `greenery`, `trace` (3D).

## The Harvest workflow

When an item needs fresh source data (a new field, a fixed harvester, a source never harvested), run the GitHub Actions harvest on your PR branch, never on `main`:

```sh
gh workflow run harvest.yml --ref claude/agent-<stream>-<slug> -f source=<kahn|parismusees|verniquet|vasserot>
gh run list --workflow harvest.yml --branch claude/agent-<stream>-<slug> --limit 1 --json databaseId,status
gh run watch <databaseId> --exit-status
git pull
```

It commits `data: harvest <source>` to your branch; pull it before going on. A full Paris Musées harvest takes over an hour. To place Paris Musées photos again after improving the matching, use `python -m rpr parismusees --offline` instead: it needs no token and no harvest. At most one harvest per run.

## When to stop and leave it to the owner

Write the question into the item (`status: blocked`, `blocked: owner — <question>`), ship that change, and say it in the report when an item needs any of:

- a secret, an account, a paid service, or accepting terms;
- a source whose licence is unclear;
- a change under `.github/` or to permissions;
- deleting committed data or a source;
- a choice of direction the backlog does not settle.

## Backlog format

One file per item, `agents/backlog/<stream>-<slug>.md`, so that parallel PRs never edit the same file:

```markdown
---
stream: photos            # photos | cite1836 | quarters | robustness | era1920
priority: 2               # 1 = first
status: open              # open | blocked | done
added: 2026-11-20
needs: []                 # file names (without .md) that must be done first
---
# Short title

Why: what it improves for someone using the site.
Done when: a measurable outcome.
Notes: where to start in the code and data, what was tried, links.
```

A run may add items to any stream, but changes only its own stream's existing items.
