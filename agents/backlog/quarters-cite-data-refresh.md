---
stream: quarters
priority: 2
status: open
added: 2026-11-21
needs: []
---
# Bring the Cité's streets, vehicles and trees up to date with the model

Why: Three committed files no longer match what their commands build, so nobody can tell a real change from old drift when a quarter is added. The street furniture and the parked vehicles were built on 2026-11-18, before the model changed on 2026-11-21, so some stand where the model now has a house.

Done when: `greenery`, `streets` and `vehicles` are rebuilt for the Cité on top of the committed model and committed; the PR gives the counts before and after and a look at 10 to 20 changed records; the README numbers that change are updated (2,493 trees, the street file's size).

Notes:
- Measured on 2026-11-21 in PR #27, with main's code and committed `site-cite.geojson` and `cite-1836.geojson` (run with `PYTHONUTF8=1`, see `robustness-pipeline-utf8-on-windows`): `site`, `model3d` and `landmarks` rebuild to the same bytes; `greenery` gives 2,491 trees against 2,493 committed (the live tree register lost two); `streets` gives column 58, kerb_stone 414, plaque 1,361 against 55, 417, 1,367; `vehicles` gives 7,301 parked and 572 moving against 7,300 and 561.
- Order: `python -m rpr greenery --area cite`, then `streets`, then `vehicles`. `streets` reads the greenery file.
- Check that the two missing trees are gone from the register, not dropped by a fetch that was cut short.
- Generated data: rebuild right before merging, on top of the latest main (PROGRAM.md, "Generated data").
