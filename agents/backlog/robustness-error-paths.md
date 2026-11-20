---
stream: robustness
priority: 4
status: open
added: 2026-11-20
needs: []
---
# Clear messages when something fails

Why: A missing data file, Panoramax down, or a lost WebGL context should say what happened and keep the rest of the site working.

Done when: each failure path tested and showing a message; no blank map or silent hang.

Notes:
- The island already falls back to the plain model and says why when the detailed one cannot be drawn (commit 89f0795); follow that pattern.
