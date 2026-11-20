---
stream: robustness
priority: 2
status: open
added: 2026-11-20
needs: []
---
# A browser smoke test of the 3D view

Why: Unit tests do not load WebGL, so a shader that fails to compile or a model that fails to load only shows in a browser.

Done when: a script (Playwright or Puppeteer with software WebGL) opens the built site, switches to the Cité in 3D at 1836 and today, and fails on a console error or the "could not be drawn" message; runnable locally, and proposed for CI in a PR the owner reviews (it changes `.github/`).
