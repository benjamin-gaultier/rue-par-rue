---
stream: robustness
priority: 4
status: open
added: 2026-11-22
needs: []
---
# Give the site a favicon

Why: every visit asks for `/favicon.ico` and gets a 404, and the browser tab shows a blank icon. The smoke test (PR #32) has to ignore that request.

Done when: `web/index.html` links an icon (an SVG of the street plaque in `web/public/` is enough), the built site serves it, and the favicon exception is removed from `classify` in `tools/smoke/lib.mjs`.
