---
stream: quarters
priority: 1
status: open
added: 2026-11-21
needs: []
---
# One table of areas, in the pipeline and in the app

Why: The model is wired to the Cité by name in about twenty places. Until an area is one entry in a table, every new quarter means editing each of them, and a missed one shows the wrong island's streets or trees.

Done when: adding an area is one entry in `AREAS` in the pipeline and one entry in a single area table in the app, with nothing else to edit; the Cité's generated files are unchanged byte for byte after the refactor (`git diff --stat web/public/data` is empty after rebuilding); tests cover the table on both sides.

Notes:
- Pipeline: every 3D command in `pipeline/rpr/cli.py` has `--area` with `choices=["cite"]`; take the choices from `AREAS` (`pipeline/rpr/sources/model3d.py`). The `build(area="cite")` functions already take the area.
- App: the file names are constants: `MODEL_URL`, `CITE_BOUNDS`, `CITE_CAMERA`, `CITE_VIEW` in `web/src/model3d.ts`, `SITE_URL` and `GREENERY_URL` in `web/src/city3d.ts`, `STREETS_URL` and its own `GREENERY_URL` in `web/src/streets.ts`, `LANDMARKS_URL` in `web/src/landmarks.ts`, `VEHICLES_URL` in `web/src/vehicles.ts`; `web/src/main.ts` builds `CITE_CENTER` from the bounds and passes the URLs to `City3D.load` and `Walker`.
- The model is named `cite-1836.geojson` while the others are `<kind>-cite.*`. Keep the names as they are in this item (renaming is a data change) and let the table hold them.
- No shader change, so this does not wait for `robustness-fxc-check`.
- Leave loading by distance to `quarters-load-by-area`: here the app still loads one area.
