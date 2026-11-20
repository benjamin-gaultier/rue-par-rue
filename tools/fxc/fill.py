"""Write ready-to-compile HLSL (placeholders filled) to the output dir: python -I fill.py outdir files..."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fxc
out = sys.argv[1]
for p in sys.argv[2:]:
    src = open(p, encoding='utf-8').read()
    if '@@ PIXEL' in src:
        open(os.path.join(out, os.path.basename(p)), 'w', encoding='utf-8').write(fxc.fill_pixel(src))
