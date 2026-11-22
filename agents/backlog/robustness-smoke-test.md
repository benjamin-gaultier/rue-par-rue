---
stream: robustness
priority: 2
status: done
done: 2026-11-22, PR #32, `npm run smoke` opens the built site in headless Chrome at 1836 and today in about 15 s and fails on a console error, a missing file, a failed module or shader, or the fallback message; first 3D frames 14 s on this PC's GPU, 4 to 7 s in software
added: 2026-11-20
needs: []
---
# A browser smoke test of the 3D view

Why: Unit tests do not load WebGL, so a shader that fails to compile or a model that fails to load only shows in a browser.

Done when: a script (Playwright or Puppeteer with software WebGL) opens the built site, switches to the Cité in 3D at 1836 and today, and fails on a console error or the "could not be drawn" message; runnable locally, and proposed for CI in a PR the owner reviews (it changes `.github/`).
