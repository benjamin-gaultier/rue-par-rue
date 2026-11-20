---
stream: photos
priority: 1
status: done
done: 2026-11-21, PR #18 — both were already merged on 2026-11-20 (#12, #14); main places 5,121 Paris Musées photos (#14 said 5,114) and 568 at a corner
added: 2026-11-20
needs: []
---
# Land the two photo PRs made before the program

Why: PR #12 (corners of streets laid out after 1836, 540 photos at a corner) and PR #14 (419 more Paris Musées captions: gardens, squares, bridges, gates, trailing words, arrondissement slips) are Claude PRs from before this program. Their placements are lost while they sit open.

Done when: both merged, and photos.geojson on main carries both gains (compare placed counts with each PR's description).

Notes:
- This item hands both PRs to the photos stream: the merge rules apply to them as if their branches were `claude/agent-photos-…`.
- #12 (`claude/street-corner-junctions`) was ready with CI green. #14 (`claude/upbeat-greider-7cce99`, draft) contains #12's commit 42cbaec, so merge #12 first.
- Then merge `origin/main` into #14, take main's generated files on conflict, rebuild them (`python -m rpr parismusees --offline`, `python -m rpr index`, thumbnails if the Cité set changed), run the checks, mark it ready, wait for CI and merge.
- Both branches are checked out in other sessions' worktrees, so work on a detached HEAD in yours: `git switch --detach origin/claude/upbeat-greider-7cce99`, merge, then `git push origin HEAD:claude/upbeat-greider-7cce99`.
- If either PR has new commits or comments from another session since 2026-11-20, read them first: that session may still be working on it.
