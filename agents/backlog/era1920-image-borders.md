---
stream: era1920
priority: 2
status: open
added: 2026-11-22
needs: []
---
# Mask plate edges, logos and card strips in the era's images

Why: A wall texture must show the street and nothing else. The full-size images still carry things that are not the picture, and they would end up on the facades.

Done when:
- For each image of `pipeline/cache/era1920/`, the index gives the rectangle that is the picture itself, and a mask of what inside it is not the scene.
- Albert-Kahn files: the dark edge of the glass plate, the inventory number written along it, and the museum's logo in the bottom-left corner are outside the rectangle or in the mask.
- Paris Musées scans: no strip of card is left. Of the 318 prints, 77 are cut from a mount today; check the other 241 and the 77 by eye on a contact sheet, and give the count of those still wrong in the PR.
- The camera of a photo (`Camera` in `pipeline/rpr/photo.py`) describes the picture itself: say in the schema which rectangle its field of view refers to, so that posing and cutting agree.

Notes:
- Seen on 2026-11-22 (PR #33) in contact sheets of 12 images per kind: every Albert-Kahn file has the plate edge and the logo; about a quarter of the Paris Musées scans not cut keep a thin cream border; one cut scan kept a blue strip on both sides.
- `rpr.sources.depth.crop_mount` finds the largest region that differs from the border colour. It gives up when the print fills more than 97% of the scan, which is why thin strips stay.
- The logo sits at the same place in every 800 px file. The 2,560 px files of `era1920-kahn-large-images` may differ.
- Keep the files as fetched; write the rectangle and the mask beside them.
