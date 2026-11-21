---
stream: era1920
priority: 3
status: open
added: 2026-11-21
needs: [era1920-pose-by-hand, photos-panoramax-match, photos-kahn-positions]
---
# Pose the photos of buildings still standing by matching Panoramax

Why: Most buildings of 1920 on the Cité still stand, so today's Panoramax pictures show the same walls. Matching can pose hundreds of photos that nobody will click through by hand.

Done when: 200 Cité photos of 1900–1929 have a full camera, hand-made and matched together; matched cameras are checked against the hand-posed set (median error in position and in bearing, in the PR); a match below the bar changes nothing.

Notes:
- Builds on the pilot of `photos-panoramax-match`. Panoramax 360° pictures have a known position and bearing, so matches to two or more of them fix the camera.
- A heavy matcher goes behind an optional extra, as `[depth]` and `[vision]` do. This PC has an RTX 3070 with 8 GB.
- Use a photo's geocoded position as the search area, not as the answer. Albert-Kahn positions may be the subject's (`photos-kahn-positions`).
- Shopfronts, trees and street furniture changed since 1920; cornices, window bays and roof lines mostly did not.
