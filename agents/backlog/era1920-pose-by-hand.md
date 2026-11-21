---
stream: era1920
priority: 2
status: open
added: 2026-11-21
needs: [era1920-pose-schema]
---
# Pose a photo by hand against the 3D model

Why: The surest pose comes from a person clicking the same points in the photo and on the model: a roof corner, a tower, the foot of a wall. It works for buildings gone since, and it gives the set against which automatic poses are checked.

Done when:
- In the 3D view, **Place this photo** lets you click at least four pairs of points (photo, model), solves the camera, and shows the photo through that camera over the model of its year.
- The result leaves the app as a link or a prefilled GitHub issue, and a pipeline command turns accepted ones into `manual` cameras.
- 50 Cité photos of 1900–1929 are posed this way; the PR gives the median reprojection error and shows five of them over the model.

Notes:
- Clicks on the model: cast a ray against the `web/src/city3d.ts` geometry standing in the photo's year. Roof corners and wall feet are the points the model has; windows are drawn by shaders and are not real positions.
- `web/src/alignment.ts` and `thennow.ts` already keep an alignment in the URL. `photos-share-alignments` plans the prefilled issue for the Panoramax viewer: share one mechanism.
- The site is static: nothing is sent without a click.
- Heights in the model are APUR medians; say in the PR how much that limits the pitch and the camera height.
