---
stream: robustness
priority: 1
status: done
done: 2026-11-21, PR #PRNUM, `python -I tools/fxc/check.py` compiles the 19 drawn fragment shaders in about 20 s; baseline 8.6 s in all, slowest walls-landmarks 2.52 s, no stack overflow
added: 2026-11-20
needs: []
---
# A one-command shader compile check for Windows

Why: The 3D view crashed Direct3D's shader compiler on Windows Chrome until PR #10. The tools that found it are in `tools/fxc/` but take several manual steps, so the next slow or crashing shader may go unnoticed.

Done when: one command (run on this Windows PC) builds every 3D shader, compiles each with d3dcompiler_47 on a 1 MB stack as ANGLE does, and prints time and instruction slots; today's numbers recorded in the README Performance section as the baseline.

Notes:
- See `tools/fxc/README.md`. Capturing the HLSL needs a browser (the harness runs in the dev page); a headless Chrome launched by a script would make it one command.
- CI runs on Linux and cannot run FXC; this is a local check for shader PRs.
