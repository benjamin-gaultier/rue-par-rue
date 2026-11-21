---
stream: photos
priority: 4
status: open
added: 2026-11-21
needs: []
---
# Depth maps for the 15 Notre-Dame photos placed since the first run

Why: The Notre-Dame set now holds 26 Paris Musées photos, and only 11 have a depth map. The other 15 were placed after the first run (2026-11-17), so they show as flat frames among the 3D photos.

Done when: `python -m rpr depth --set notre-dame` reports 0 failed, and `manifest.json` counts 96 depth maps (81 today).

Notes:
- On 2026-11-21 every download of these 15 images was cut short ("IncompleteRead"; curl stops with an HTTP/2 stream error after about 14 kB). The same server served them on 2026-11-17. Try again first; if it still fails, find out whether the server throttles, or whether `rpr/net.py` should ask for HTTP/1.1 or resume with a Range request.
