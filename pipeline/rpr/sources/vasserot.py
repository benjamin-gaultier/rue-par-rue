"""Vasserot cadastre vectors (1810-1836) from the ALPAGE project.

Stanford Libraries host the layers and already publish them as PMTiles
vector tiles, so we copy those files as they are. Licence: ODbL 1.0,
credit "Arch. nat. F31 73-96 - Arch. Paris (c) ALPAGE".
"""

from __future__ import annotations

from typing import Any, Callable

from rpr import net, paths

LAYERS = {
    # key: (Stanford druid, file stem, what it is)
    "voirie": ("gy980ch3900", "Vasserot_Emprise_de_la_voirie", "Street space (road network footprint)"),
    "ilots": ("bz020fp6123", "Vasserot_Ilots", "City blocks"),
    "parcelles": ("qr091wq2775", "Vasserots_parcelles2_v", "Parcels"),
}
PURL = "https://purl.stanford.edu/{druid}.json"
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{filename}"
LICENSE = "ODbL-1.0"
ATTRIBUTION = "Vasserot cadastre: Arch. nat. F31 73-96, Arch. Paris, © ALPAGE (ODbL)"


def list_files(druid: str) -> dict[str, int]:
    """Return {filename: size} for a Stanford object, from its PURL record."""
    record = net.fetch_json(PURL.format(druid=druid))
    files = {}
    for fileset in record.get("structural", {}).get("contains", []):
        for f in fileset.get("structural", {}).get("contains", []):
            if f.get("access", {}).get("download") == "world":
                files[f["filename"]] = f.get("size", 0)
    return files


def harvest(log: Callable[[str], Any] = print) -> dict:
    out = {}
    for key, (druid, stem, label) in LAYERS.items():
        filename = f"{stem}.pmtiles"
        files = list_files(druid)
        if filename not in files:
            raise RuntimeError(f"{filename} not listed for {druid}; files: {sorted(files)}")
        dest = paths.VASSEROT_DIR / f"{key}.pmtiles"
        size = net.download(STACKS.format(druid=druid, filename=filename), dest, timeout=300)
        if files[filename] and size != files[filename]:
            raise RuntimeError(f"{filename}: got {size} bytes, expected {files[filename]}")
        log(f"vasserot: {key} -> {dest.relative_to(paths.REPO_ROOT)} ({size / 1e6:.1f} MB)")
        out[key] = {
            "file": f"vasserot/{key}.pmtiles",
            "label": label,
            "source_layer": f"{stem}fgb",
            "druid": druid,
            "bytes": size,
        }
    return {"layers": out, "license": LICENSE, "attribution": ATTRIBUTION}
