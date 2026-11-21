---
stream: robustness
priority: 3
status: open
added: 2026-11-21
needs: [robustness-fxc-check]
---
# Shorter shader compiles on Windows

Why: on Windows Chrome the 19 fragment shaders take 8.6 s of FXC compile before everything is drawn (2026-11-21, `python -I tools/fxc/check.py`). Three of them make up two thirds of it: walls-landmarks 2.52 s, facades 2.20 s, details 1.27 s.

Done when: no shader over 1.5 s and the total under 6 s in `tools/fxc/check.py`, with the same picture at 1790, 1836, 1900 and today; the limit in `check.py` lowered to match and the README table updated.

Notes:
- `python -I tools/fxc/check.py --keep DIR` keeps the HLSL; `fxc.py <file> skipopt|avoidflow|preferflow` shows which compiler pass is slow.
- walls-landmarks has 4,679 instruction slots against 1,231 for plain walls: splitting the landmark family by monument (as PR #10 split the families) is the first thing to try.
- The check compiles fragment shaders only. Adding the vertex shaders needs `fill_pixel`'s counterpart for ANGLE's vertex placeholders in `tools/fxc/fxc.py`.
