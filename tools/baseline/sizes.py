"""Download size of an area's 3D data, file by file.

    python -I tools/baseline/sizes.py [--area cite] [--markdown]

Prints the size of each file in web/public/data/3d/ that belongs to the area,
as stored and gzipped (level 6, close to what a web server sends), and counts
the features in the model. Images are already compressed: their folders are
given as stored. Standard library only.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "3d"
IMAGE_DIRS = ("thumbs", "depth")


def area_files(area: str) -> list[Path]:
    """Data files named after the area: `<kind>-<area>.*`, and the model `<area>-<year>.geojson`."""
    return sorted(p for p in DATA.iterdir() if p.is_file() and (f"-{area}." in p.name or p.name.startswith(f"{area}-")))


def gzipped(data: bytes) -> int:
    return len(gzip.compress(data, 6, mtime=0))


def model_counts(path: Path) -> dict[str, int]:
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    kinds: dict[str, int] = {}
    for f in features:
        kind = f["properties"].get("kind", "?")
        kinds[kind] = kinds.get(kind, 0) + 1
    return {"features": len(features), "detailed": sum(1 for f in features if f["properties"].get("focus")), **kinds}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--area", default="cite")
    ap.add_argument("--markdown", action="store_true", help="print the table for the README")
    args = ap.parse_args()

    rows: list[tuple[str, int, int | None]] = []
    for p in area_files(args.area):
        data = p.read_bytes()
        rows.append((p.name, len(data), gzipped(data)))
    data_raw = sum(r[1] for r in rows)
    data_gz = sum(r[2] or 0 for r in rows)
    rows.append((f"All data files ({len(rows)})", data_raw, data_gz))
    for name in IMAGE_DIRS:
        files = [p for p in (DATA / name).rglob("*") if p.is_file()] if (DATA / name).is_dir() else []
        rows.append((f"{name}/ ({len(files):,} files)", sum(p.stat().st_size for p in files), None))

    def mb(n: int | None) -> str:
        return "" if n is None else f"{n / 1e6:.2f}"

    if args.markdown:
        print("| File | MB | MB gzipped |")
        print("| --- | ---: | ---: |")
        for name, raw, gz in rows:
            print(f"| {name} | {mb(raw)} | {mb(gz)} |")
    else:
        for name, raw, gz in rows:
            print(f"{name:40} {mb(raw):>8} {mb(gz):>8}")

    models = [p for p in area_files(args.area) if p.name.startswith(f"{args.area}-")]
    for p in models:
        print()
        print(p.name + ": " + ", ".join(f"{k} {v:,}" for k, v in model_counts(p).items()))


if __name__ == "__main__":
    main()
