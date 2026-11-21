---
stream: quarters
priority: 1
status: open
added: 2026-11-20
needs: [robustness-fxc-check, quarters-area-table, quarters-saint-louis-sources]
---
# The Île Saint-Louis in detail

Why: The Cité's neighbour is small, almost entirely 17th-century and well documented: the cheapest next quarter, and the first test of the model beyond one island.

Done when: the island and its quays drawn in detail with its bridges through time (pont Marie, pont de la Tournelle, pont Saint-Louis, pont Louis-Philippe), walkable at 1836 and today, with data size and frame time measured against the Cité alone.

Notes:
- Add the island as one entry in `AREAS` in `pipeline/rpr/areas.py` and one in `web/src/areas.ts` (README, "Areas"); the app loads only `AREA`, so until `quarters-load-by-area` either switch it by hand to look, or load both. Areas have `focus` and `focus_river_m` (used by `focus_area` in `pipeline/rpr/sources/site.py`); the commands are `site`, `greenery`, `model3d` and `trace` with `--area`.
- Check the bridges' dates against sources, as the README does for the Cité's.
