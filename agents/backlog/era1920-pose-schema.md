---
stream: era1920
priority: 1
status: open
added: 2026-11-21
needs: []
---
# A full camera pose in the photo schema, and full-size images for the era

Why: A photo can be laid on a wall only when its camera is known: where it stood, which way it looked, how far it was tilted and how wide it saw. Today every photo has a position, 18% have a bearing, and none has the rest. The 224 px thumbnails are also too small to become a facade.

Done when:
- `pipeline/rpr/photo.py` carries an optional camera: position, height above the ground, bearing, pitch, roll, horizontal field of view, the method (`manual`, `matched`), a confidence, and the reprojection error when it was solved from points. The heading stays as it is; the camera is a separate, stricter record.
- `manifest.json` counts the photos with a full camera, in all and for 1900–1929 (0 today).
- A pipeline command fetches the full-size images of the photos of 1900–1929 around the Cité into `pipeline/cache/` (not committed), with Paris Musées prints cut out of their mounts. The PR gives how many images and their size on disk.

Notes:
- Mount cropping exists in `pipeline/rpr/sources/depth.py`.
- Around the Cité: 1,166 photos dated within three years in 1900–1929 (690 Albert-Kahn, 476 Paris Musées). Fetch Kahn images only for the licences cleared by `era1920-kahn-licence`.
- The app reads `photos.geojson` through `web/src/photos.ts`; add the camera to its types, unused for now.
