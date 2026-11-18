"""Command line entry point: `python -m rpr <command>`."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from rpr import paths
from rpr.photo import build_index, write_source


def _update_manifest(key: str, value: dict) -> None:
    path = paths.DATA_DIR / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    value = {**value, "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    manifest[key] = value
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


def cmd_verniquet(args: argparse.Namespace) -> None:
    from rpr.sources import verniquet

    _update_manifest("verniquet", verniquet.harvest(args.images))


def cmd_vasserot(args: argparse.Namespace) -> None:
    from rpr.sources import vasserot

    _update_manifest("vasserot", vasserot.harvest())


def cmd_kahn(args: argparse.Namespace) -> None:
    from rpr.sources import kahn

    if args.inspect:
        kahn.inspect()
        return
    info, photos = kahn.harvest()
    summary = write_source(info, photos)
    print(f"kahn: kept {summary['count']}, rejected {summary['rejected']}")
    build_index()


def cmd_parismusees(args: argparse.Namespace) -> None:
    from rpr.sources import parismusees

    if args.introspect:
        parismusees.introspect()
        return
    info, photos = parismusees.harvest()
    summary = write_source(info, photos)
    print(f"parismusees: kept {summary['count']}, rejected {summary['rejected']}")
    build_index()


def cmd_model3d(args: argparse.Namespace) -> None:
    from rpr.sources import model3d

    manifest_key = f"model3d_{args.area}"
    _update_manifest(manifest_key, model3d.build(args.area))


def cmd_trace(args: argparse.Namespace) -> None:
    from rpr.sources import vasserot_plans

    _update_manifest(f"traced_{args.area}", vasserot_plans.trace(args.area, limit=args.limit))


def cmd_thumbs(args: argparse.Namespace) -> None:
    from rpr.sources import thumbs

    _update_manifest(f"thumbs_{args.area}", thumbs.build(args.area, rebuild=args.rebuild))


def cmd_depth(args: argparse.Namespace) -> None:
    from rpr.sources import depth

    _update_manifest(f"depth_{args.set.replace('-', '_')}", depth.build(args.set))


def cmd_site(args: argparse.Namespace) -> None:
    from rpr.sources import site

    _update_manifest(f"site_{args.area}", site.build(args.area))


def cmd_greenery(args: argparse.Namespace) -> None:
    from rpr.sources import greenery

    _update_manifest(f"greenery_{args.area}", greenery.build(args.area))


def cmd_landmarks(args: argparse.Namespace) -> None:
    from rpr.sources import landmarks

    _update_manifest(f"landmarks_{args.area}", landmarks.build(args.area))


def cmd_index(args: argparse.Namespace) -> None:
    manifest = build_index()
    print(f"index: {manifest['photos']['count']} photos from {len(manifest['photos']['sources'])} sources")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rpr", description="Rue par Rue data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("verniquet", help="Verniquet atlas (1790) georeference annotations")
    p.add_argument("--images", choices=["rumsey", "bnf"], default="rumsey")
    p.set_defaults(func=cmd_verniquet)

    p = sub.add_parser("vasserot", help="Vasserot cadastre (1810-1836) vector tiles")
    p.set_defaults(func=cmd_vasserot)

    p = sub.add_parser("kahn", help="Albert-Kahn autochromes of Paris")
    p.add_argument("--inspect", action="store_true", help="print the live field list and stop")
    p.set_defaults(func=cmd_kahn)

    p = sub.add_parser("parismusees", help="Paris Musées photographs (needs PARISMUSEES_TOKEN)")
    p.add_argument("--inspect", "--introspect", dest="introspect", action="store_true", help="print the GraphQL query fields and stop")
    p.set_defaults(func=cmd_parismusees)

    p = sub.add_parser("model3d", help="3D massing model of an area in 1836 (needs the [geo] extras)")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.set_defaults(func=cmd_model3d)

    p = sub.add_parser("trace", help="trace building footprints from Vasserot's plans (needs [geo] and [vision])")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.add_argument("--limit", type=int, default=None)
    p.set_defaults(func=cmd_trace)

    p = sub.add_parser("thumbs", help="same-origin thumbnails for photo frames in the 3D view (needs Pillow, OpenCV)")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.add_argument("--rebuild", action="store_true", help="redo existing thumbnails")
    p.set_defaults(func=cmd_thumbs)

    p = sub.add_parser("depth", help="AI depth maps for a set of photos (needs onnxruntime, numpy, Pillow)")
    p.add_argument("--set", choices=["notre-dame"], default="notre-dame")
    p.set_defaults(func=cmd_depth)

    p = sub.add_parser("site", help="the Seine, bridges and landmark details of a model area (IGN BD TOPO, needs shapely)")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.set_defaults(func=cmd_site)

    p = sub.add_parser("greenery", help="gardens and trees of a model area (Paris tree register, APUR; needs shapely)")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.set_defaults(func=cmd_greenery)

    p = sub.add_parser("landmarks", help="landmarks of a model area through time: styles, dates, spires, towers, statues (needs shapely)")
    p.add_argument("--area", choices=["cite"], default="cite")
    p.set_defaults(func=cmd_landmarks)

    p = sub.add_parser("index", help="rebuild photos.geojson and manifest.json")
    p.set_defaults(func=cmd_index)

    args = parser.parse_args(argv)
    args.func(args)
    return 0
