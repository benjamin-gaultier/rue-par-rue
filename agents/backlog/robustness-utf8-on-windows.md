---
stream: robustness
priority: 3
status: open
added: 2026-11-20
needs: []
---
# Write generated files as UTF-8 on Windows

Why: on this PC the pipeline writes some generated files in the Windows code page, which mangles names like "Île de la Cité" in `web/public/data/manifest.json` and broke the encoding of `vasserot-traced-cite.geojson` (fixed for that file in PR #17).

Done when: every `open()`, `read_text()` and `write_text()` in `pipeline/rpr` gives `encoding="utf-8"` (or the CLI sets UTF-8 mode), and a test or a lint check keeps it so.

Notes:
- PR #17 ran the pipeline with `PYTHONUTF8=1` as a workaround. `rpr/cli.py` `_update_manifest` and `rpr/sources/model3d.py` are the files seen to break.
