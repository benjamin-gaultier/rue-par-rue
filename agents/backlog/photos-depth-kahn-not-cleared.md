---
stream: photos
priority: 2
status: blocked
blocked: owner — 8 published depth maps were computed from Albert-Kahn photos the open data marks as still under copyright. Remove them (deleting committed data), or keep them?
added: 2026-11-21
needs: []
---
# Depth maps made from Kahn photos that are not cleared for reuse

Why: Licences travel with the data. A depth map is derived from its photo, and these eight photos are marked "Libre de droits: Non" in the open data.

Done when: the owner has decided; if they go, `rpr depth` skips photos whose licence is not in `rpr.sources.kahn.DERIVABLE` and the eight files are rebuilt away, not deleted by hand.

Notes:
- The photos: `kahn:A 191 S`, `kahn:A 192 S`, `kahn:A 69 774 X`, `kahn:A 7 525`, `kahn:A 73 619 X`, `kahn:A 73 944 X`, `kahn:A 73 945 X`, `kahn:A 91` (in `web/public/data/3d/depth/index.json`).
- The other 70 Kahn depth maps come from cleared photos (46 "CC0 or CC BY 4.0", 24 CC BY 4.0).
- Found by `era1920-kahn-licence` (PR #25); the licence values are explained in DATA_SOURCES.md, "Albert-Kahn licences".
