"""The table of 3D areas: one entry is all an area needs, here and in the app."""

import re
from pathlib import Path

import pytest

from rpr import areas, cli, paths
from rpr.sources import model3d, site, vasserot_plans

AREA_COMMANDS = ["model3d", "trace", "thumbs", "site", "institutions", "greenery", "streets", "landmarks", "vehicles"]
APP_TABLE = paths.REPO_ROOT / "web" / "src" / "areas.ts"
# The files the app loads; `traced` and `institutions` only feed `model3d`.
APP_KINDS = ["model", "site", "greenery", "streets", "landmarks", "vehicles"]


def test_every_area_has_a_box_and_a_name():
    for key, cfg in areas.AREAS.items():
        assert re.fullmatch(r"[a-z][a-z0-9-]*", key), key
        assert cfg["name"]
        west, south, east, north = cfg["bbox"]
        assert west < east and south < north
        if cfg.get("focus"):
            fw, fs, fe, fn = cfg["focus"]
            assert west <= fw < fe <= east and south <= fs < fn <= north


def test_file_names_are_those_committed_for_the_cite():
    names = {kind: areas.file_name("cite", kind) for kind in areas.FILES}
    assert names == {
        "model": "cite-1836.geojson",
        "traced": "vasserot-traced-cite.geojson",
        "institutions": "institutions-cite.geojson",
        "site": "site-cite.geojson",
        "greenery": "greenery-cite.json",
        "streets": "streets-cite.json",
        "landmarks": "landmarks-cite.json",
        "vehicles": "vehicles-cite.json",
    }
    assert areas.area_file("cite", "site") == paths.DATA_DIR / "3d" / "site-cite.geojson"
    assert areas.manifest_file("cite", "model") == "3d/cite-1836.geojson"


def test_an_unknown_area_is_refused():
    with pytest.raises(KeyError):
        areas.file_name("atlantis", "model")


def test_other_modules_see_the_same_table():
    assert model3d.AREAS is areas.AREAS
    assert site.AREAS is areas.AREAS


@pytest.mark.parametrize("command", AREA_COMMANDS)
def test_every_3d_command_takes_any_area(command, monkeypatch):
    monkeypatch.setitem(areas.AREAS, "saint-louis", {"name": "Île Saint-Louis", "bbox": (2.351, 48.849, 2.362, 48.855)})
    seen = {}
    monkeypatch.setattr(cli, f"cmd_{command}", lambda args: seen.update(area=args.area))
    # A new entry is enough for the command line to take it.
    assert cli.main([command, "--area", "saint-louis"]) in (0, None)
    assert seen == {"area": "saint-louis"}
    # The first area stays the default.
    cli.main([command])
    assert seen == {"area": "cite"}


def test_an_area_builds_without_what_only_another_has(monkeypatch):
    monkeypatch.setitem(areas.AREAS, "saint-louis", {"name": "Île Saint-Louis", "bbox": (2.351, 48.849, 2.362, 48.855)})
    assert site.LANDMARKS.get("saint-louis", []) == []
    assert site.OLD_LINES.get("saint-louis", []) == []
    assert model3d.load_traced("saint-louis", None) == {}
    assert model3d.load_institutions("saint-louis") == ([], set())
    # Tracing needs the quarters' names: it says so rather than tracing nothing.
    with pytest.raises(ValueError, match="vasserot"):
        vasserot_plans.quarters_of("saint-louis")
    assert vasserot_plans.quarters_of("cite")["plans"] == ("Cité", "Palais de Justice")


def app_areas() -> dict[str, str]:
    """Each area's entry in the app's table, as source text by key."""
    text = APP_TABLE.read_text(encoding="utf-8")
    table = text[text.index("export const AREAS = {") : text.index("} satisfies Record<string, Area>")]
    keys = re.findall(r"^  (?:'([a-z0-9-]+)'|([a-z0-9]+)): \{$", table, flags=re.M)
    starts = [m.start() for m in re.finditer(r"^  (?:'[a-z0-9-]+'|[a-z0-9]+): \{$", table, flags=re.M)]
    bodies = [table[a:b] for a, b in zip(starts, starts[1:] + [len(table)])]
    return {quoted or bare: body for (quoted, bare), body in zip(keys, bodies)}


def test_the_app_table_agrees_with_this_one():
    app = app_areas()
    assert set(app) <= set(areas.AREAS), "the app names an area the pipeline does not build"
    assert "cite" in app
    for key, body in app.items():
        cfg = areas.AREAS[key]
        assert f"key: '{key}'" in body
        assert f"name: '{cfg['name']}'" in body
        bounds = re.search(r"bounds: \[([^\]]+)\]", body)
        assert bounds and tuple(float(v) for v in bounds.group(1).split(",")) == cfg["bbox"]
        for kind in APP_KINDS:
            assert f"{kind}: `${{DIR}}{areas.file_name(key, kind)}`" in body, (key, kind)


def test_no_3d_file_name_is_written_by_hand():
    """Sources name the area's files through the table, so a new area needs no edit there."""
    by_hand = re.compile(r"f\"[^\"]*(?:-\{area\}\.(?:geo)?json|\{area\}-1836)")
    for path in sorted(Path(areas.__file__).parent.rglob("*.py")):
        if path.name == "areas.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "fetch_cached(" in line:  # download caches are named by area on purpose
                continue
            assert not by_hand.search(line), f"{path.name}:{number}: use rpr.areas.area_file"
