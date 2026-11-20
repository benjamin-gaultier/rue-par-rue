---
stream: robustness
priority: 3
status: open
added: 2026-11-20
needs: []
---
# Faster first load of the 3D view

Why: The 3D model, trees and thumbnails all load before the first frame. On a phone connection that is a long wait.

Done when: bytes and time to the first 3D frame measured on the live site, the largest costs cut (split by year, compress, defer what is out of view), before → after in the PR.
