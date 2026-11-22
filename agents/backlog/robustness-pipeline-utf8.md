---
stream: robustness
priority: 3
status: open
added: 2026-11-22
needs: []
---
# Pipeline files written in UTF-8 whatever the PC's settings

Why: `rpr.photo.write_source` and `build_index` call `write_text` and `read_text` without an encoding, and so do about fifteen other places in `pipeline/rpr/`. On Windows without `PYTHONUTF8=1` Python then writes `photos.geojson` in cp1252: "Musée" becomes one byte, the file is no longer valid JSON for the browser, and the diff touches every accented caption. A run on 2026-11-22 hit this and had to rebuild with `PYTHONUTF8=1`.

Done when: every `read_text`, `write_text` and `open` of a text file in `pipeline/rpr/` names `encoding="utf-8"`, a test fails if one is added without it, and `python -m rpr index` gives the same bytes with and without `PYTHONUTF8=1`.

Notes: find them with `grep -rn "read_text()\|write_text(" pipeline/rpr | grep -v encoding`. CI runs on Linux, so it does not see the problem.
