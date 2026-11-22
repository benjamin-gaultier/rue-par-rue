"""Committed data files are UTF-8.

On Windows, a pipeline run without UTF-8 mode wrote the Cité model in the
Windows code page ("Île de la Cité" as two stray bytes). Browsers read JSON
as UTF-8, so the names came out broken. CI runs on Linux and never writes
such a file, so this test reads the committed ones.
"""

from rpr import paths

DATA = paths.REPO_ROOT / "web" / "public" / "data"


def test_committed_json_is_utf8():
    files = sorted(p for p in DATA.rglob("*") if p.suffix in {".json", ".geojson"})
    assert files, "no data files found"
    broken = []
    for path in files:
        try:
            path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as err:
            broken.append(f"{path.relative_to(paths.REPO_ROOT)}: {err}")
    assert not broken, "not UTF-8 (rebuild with PYTHONUTF8=1): " + "; ".join(broken)
