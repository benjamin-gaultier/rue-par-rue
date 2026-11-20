---
stream: robustness
priority: 3
status: open
added: 2026-11-20
needs: []
---
# Make the 3D model rebuild to the same bytes

Why: on 2026-11-20, `python -m rpr model3d --area cite` with main's own inputs and the same library versions changed 849 estimated heights and 180 footprints against the model committed on 2026-11-18. Every PR that rebuilds the model then carries unrelated changes, and real changes are hard to review.

Done when: two rebuilds on the same commit give identical files, and the inputs fetched live (APUR buildings) are cached or pinned so a rebuild on another day gives the same model unless the inputs changed on purpose.

Notes:
- Heights come from `estimated_height(key)` with the lot index in the key, so a different lot order changes heights.
- APUR buildings are fetched live in `fetch_apur` (`rpr/sources/model3d.py`).
