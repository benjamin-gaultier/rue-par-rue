"""The areas modelled in 3D: one entry each, and nothing else to edit.

Every 3D command (`model3d`, `trace`, `thumbs`, `site`, `institutions`,
`greenery`, `streets`, `landmarks`, `vehicles`) takes `--area` with the keys of
`AREAS`, and names its file with `area_file`. The app has the same table in
web/src/areas.ts; tests/test_areas.py checks that the two agree.

What only one area has (a bridge's history, a spire, a traced institution)
stays in the module that draws it, keyed by area, and an area without it
builds without it.
"""

from __future__ import annotations

from pathlib import Path

from rpr import paths

AREAS = {
    # Île de la Cité and the quays facing it. `focus` is the area rendered
    # with detailed buildings (facades, roofs) in the app: with
    # `focus_river_m`, only the islands and the banks within that many metres
    # of the Seine inside it (site.focus_area), so the whole island and the
    # facing quays are detailed and the streets behind stay plain blocks.
    # `vasserot` names the area's quarters as written in the index of
    # Vasserot's plans and in the ALPAGE layers (`trace`); without it nothing
    # is traced.
    "cite": {
        "name": "Île de la Cité",
        "bbox": (2.3385, 48.8505, 2.3565, 48.8590),
        "focus": (2.3385, 48.8505, 2.3565, 48.8590),
        "focus_river_m": 90,
        "vasserot": {"plans": ("Cité", "Palais de Justice"), "alpage": ("Cite", "Palais de Justice")},
    },
}

# File of each kind in web/public/data/3d/. The model is `<area>-1836` and the
# others `<kind>-<area>`: kept as they were when the Cité was the only area.
FILES = {
    "model": "{area}-1836.geojson",
    "traced": "vasserot-traced-{area}.geojson",
    "institutions": "institutions-{area}.geojson",
    "site": "site-{area}.geojson",
    "greenery": "greenery-{area}.json",
    "streets": "streets-{area}.json",
    "landmarks": "landmarks-{area}.json",
    "vehicles": "vehicles-{area}.json",
}


def area_names() -> list[str]:
    return list(AREAS)


def file_name(area: str, kind: str) -> str:
    """Name of an area's file of one kind, as in FILES."""
    if area not in AREAS:
        raise KeyError(f"unknown area {area!r}: add it to AREAS in rpr/areas.py")
    return FILES[kind].format(area=area)


def area_file(area: str, kind: str) -> Path:
    """Where an area's file of one kind is written."""
    return paths.DATA_DIR / "3d" / file_name(area, kind)


def manifest_file(area: str, kind: str) -> str:
    """The same file as the manifest names it, relative to web/public/data/."""
    return f"3d/{file_name(area, kind)}"
