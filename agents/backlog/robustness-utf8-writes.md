---
stream: robustness
priority: 2
status: open
added: 2026-11-28
needs: []
---
# Write every generated file as UTF-8

Why: on Windows, `Path.write_text()` without `encoding=` writes in the system code page (cp1252). `python -m rpr model3d` on this PC wrote `cite-1836.geojson` with "Île de la Cité" in cp1252, which the browser and `test_directories.py` cannot read. PR for `cite1836-corrected-rejects` fixed `model3d.py` only.

Done when: every `write_text` and `open(..., "w")` in `pipeline/rpr/` that writes data passes `encoding="utf-8"`, and a test fails when one does not (for instance a grep over the package in pytest).

Notes: still without an encoding on 2026-11-28: `photo.py` (238, 253, 263), `sources/greenery.py`, `institutions.py`, `landmarks.py`, `monuments.py`, `places.py`, `site.py`, `streets.py`, `thumbs.py`, `vehicles.py` (two), `verniquet.py`. Most write `ensure_ascii=False` JSON, so any accented name breaks.
