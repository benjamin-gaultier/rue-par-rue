---
stream: photos
priority: 5
status: open
added: 2026-11-20
needs: []
---
# Let people send the alignments they make in the viewer

Why: Visitors line up archive photos over Panoramax by hand; that alignment is the best pose there is, but it stays in their URL.

Done when: a "Suggest this alignment" button opens a prefilled GitHub issue (photo id, Panoramax picture, bearing, pitch, field of view), and a pipeline command turns accepted issues into `manual` poses.

Notes:
- The site is static: no backend. A prefilled issue link needs none.
- Nothing is sent without the visitor clicking.
