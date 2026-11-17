"""Where the pipeline writes its outputs.

Everything the web app reads lives under web/public/data so that a static
build (GitHub Pages, any CDN) can serve it without a backend.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("RPR_DATA_DIR", REPO_ROOT / "web" / "public" / "data"))
PHOTOS_DIR = DATA_DIR / "photos"
VASSEROT_DIR = DATA_DIR / "vasserot"
