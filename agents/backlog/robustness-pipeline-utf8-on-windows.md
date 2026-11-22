---
stream: robustness
priority: 3
status: done
done: 2026-11-22, duplicate, folded into robustness-utf8-on-windows (still open)
added: 2026-11-21
needs: []
---
# The pipeline writes broken data when run on Windows without UTF-8 mode

Why: `python -m rpr kahn` on this PC wrote `kahn.geojson` in cp1252 and then failed to read it back (`UnicodeDecodeError` in `build_index`). Agents rebuild data on this PC, so a silent wrong encoding can reach a commit.

Done when: every `read_text`, `write_text` and `open` in `pipeline/rpr/` names `encoding="utf-8"`, a test fails if one does not, and `python -m rpr index` gives the same bytes on Windows and on the Linux runners.

Notes:
- Seen in `pipeline/rpr/photo.py` (`write_source`, `build_index`). Until fixed, run pipeline commands with `PYTHONUTF8=1`.
- Found by `era1920-kahn-licence` (PR #25).
