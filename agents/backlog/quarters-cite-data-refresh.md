---
stream: quarters
priority: 2
status: done
done: 2026-11-22, PR #34, greenery, streets and vehicles rebuilt on the current model (trees 2,493 → 2,491, parked vehicles 7,300 → 7,301, moving 561 → 572); the model file, committed in the Windows code page, is UTF-8 again and a test reads every committed data file as UTF-8
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

Found on 2026-11-22:
- The register holds 2,492 trees in the ground box and the export returns all 2,492; one stands inside a building of today and is skipped. The two missing trees (a young chestnut near 2.348358, 48.853872 and a young tree near 2.357131, 48.853422) are no longer in the register.
- No parked vehicle had its centre inside a model building of its years, before or after: the worry in "Why" did not hold for vehicles. Street furniture inside buildings is the same before and after, so it comes from the code, not from old data: see `quarters-street-furniture-in-buildings`.
- Much of the change in the streets file comes from the live Paris Data sets (bollards 9,551 → 9,558, benches moved, Morris columns 29 → 32), not from the model.
- The committed `cite-1836.geojson` was written in the Windows code page by an earlier run (commit 18fdfa5): `greenery` could not read it in UTF-8 mode. Rebuilt with `PYTHONUTF8=1`, the features are the same but for the encoding of their names.
