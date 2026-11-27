"""When the old houses of the Île de la Cité came down, from dated sources.

The massing model rebuilds every house of the Vasserot cadastre (about 1836)
that no building standing today covers. They used to disappear all at once
in 1860, a default that no source gives. On the Cité the works that removed
them are documented, street by street and site by site, and this module
gives each house the year of the works that took it.

Each clearance in CLEARANCES says which houses it took with one or more of
these tests, and a house must pass every test the clearance gives:

* `parcels`: the house is on one of these Vasserot parcels, read off the cadastre;
* `site`: at least half of it lies inside the outline of what replaced it,
  from APUR's register of public facilities (EQUIPEMENT_EMPRISE);
* `streets`: its parcel fronts one of these 1836 streets, from Vasserot's
  address points (ALPAGE, pipeline/cache/vasserot-1836.json);
* `near`: the facility outline nearest to it, within NEAR_REACH_M, is one of these;
* `open_space`: True when no building standing today covers most of it,
  so a street or square took its place.

The first clearance that matches wins, so specific ones come first.
`reasoned` is True when the year is inferred rather than stated for these
houses: a house under today's street beside a building site most likely
went with the works on that site.

A dated photograph that shows a house proves it stood that year. PHOTOS
lists photographs of the Cité's old streets; the houses on the streets a
photo shows stand at least until the year after it was taken. Which houses
are in the frame is read from the photo's title, so the result is reasoned.
A year stated by a source for the works wins over a photo; the clash is
logged for review.

A house is shown gone from `until` on: the year its demolition was done.
Houses razed in the last weeks of a year stand through it.

Houses off the Cité, and Cité houses no source dates, keep the old default
(DEFAULT_UNTIL) and say so in the data.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Callable

from rpr import paths

# Shown until then where no source gives a year: Haussmann's works on the
# Cité began about 1858-1860 (approximation, not a date from a source).
DEFAULT_UNTIL = 1860
# 1836 quarters on the island (Vasserot's QUARTIER field).
CITE_QUARTERS = ("Cite", "Palais de Justice")
# A house stands in a facility's outline when this share of it lies inside.
SITE_SHARE = 0.5
# An address point belongs to the nearest parcel within this distance (m).
# The points sit on the street front, a metre or two outside the parcel.
ADDRESS_REACH_M = 6.0
# How far a house under today's street may be from the site it is dated by (m).
NEAR_REACH_M = 15.0

# The base of the place Dauphine's triangle, the houses on the even side of
# the rue de Harlay, read off the cadastre between the place and the street.
# landmarks.py keeps them in the 3D view until the same year.
DAUPHINE_EAST_SIDE = [f"PA34{n}" for n in range(11, 28)]
DAUPHINE_EAST_UNTIL = 1874

HOTEL_DIEU = "HÔTEL DIEU"
PREFECTURE = "PRÉFECTURE DE POLICE"  # the Cité barracks, now the Préfecture de police
FLOWER_MARKET = "MARTCHÉ DE LA CITÉ"  # sic in APUR's register
TRIBUNAL = "TRIBUNAL DE COMMERCE"

_VERGUE = "https://vergue.com/post/"
_WIKI = "https://fr.wikipedia.org/wiki/"
_NOMENCLATURE = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/denominations-emprises-voies-actuelles/records?where=id%3D"

CLEARANCES: list[dict[str, Any]] = [
    {
        "id": "dauphine-east-side",
        "until": DAUPHINE_EAST_UNTIL,
        "parcels": DAUPHINE_EAST_SIDE,
        "reasoned": False,
        "note": "The east side of the place Dauphine (the even side of the rue de Harlay) burned in the fighting of the Commune in 1871 and was demolished in 1874 to open the view of Duc's new front of the Palais.",
        "source": "French Wikipedia, Place Dauphine",
        "url": _WIKI + "Place_Dauphine",
    },
    {
        "id": "rue-d-arcole",
        "until": 1866,
        "streets": ("rue saint pierre aux boeufs", "rue du chevet saint landry", "impasse sainte marine"),
        "reasoned": False,
        "note": "The rue d'Arcole was moved east by the decree of 22 May 1865, and every house on both sides came down: from the parvis to the rue de Constantine in November-December 1865, on to the quai in April-June 1866. Marville photographed the old street from the parvis before (Paris Musées 320002473). The street's first widening in 1837 is not modelled: the houses it cut back stand here until 1866 too.",
        "source": "vergue.com, Rue d'Arcole, after the city's records; French Wikipedia, Rue d'Arcole; decree of 22 May 1865 (Ville de Paris street names, record 9034)",
        "url": _VERGUE + "633/Rue-Arcole.html",
    },
    {
        "id": "hotel-dieu-north-edge",
        "until": 1867,
        "site": (HOTEL_DIEU,),
        "streets": ("rue de la lanterne", "rue du haut moulin"),
        "reasoned": True,
        "note": "On the north edge of the new Hôtel-Dieu's site the houses came down in 1866-1867: the south side of the rue du Haut-Moulin in May-July 1866, its north side and the east side of the rue de la Cité north of the rue de Constantine in April-May 1867. The two sides are not told apart here, so all stand until 1867.",
        "source": "vergue.com, Rue du Haut-Moulin and Rue de la Cité, after the city's records",
        "url": _VERGUE + "628/Rue-du-Haut-Moulin.html",
    },
    {
        "id": "hotel-dieu",
        "until": 1866,
        "site": (HOTEL_DIEU,),
        "reasoned": False,
        "note": "Razed for the new Hôtel-Dieu (public utility declared 22 May 1865, built 1866-1877). The houses on its site came down from November 1865 to May 1867, most of them in 1866: the rue Saint-Christophe, the rue des Trois-Canettes and the rue de la Licorne first, then the rue de Glatigny, the Ursins streets and the rue Saint-Landry.",
        "source": "vergue.com, Rue Saint-Christophe, Rue des Trois-Canettes and Rue de la Cité, after the city's records; French Wikipedia, Hôtel-Dieu de Paris",
        "url": _VERGUE + "635/Rue-Saint-Christophe.html",
    },
    {
        "id": "parvis",
        "until": 1874,
        "streets": ("rue neuve notre dame", "rue saint christophe"),
        "reasoned": True,
        "note": "The rue Neuve-Notre-Dame and what was left of the rue Saint-Christophe were taken into the enlarged parvis about 1874, the year the old foundlings' hospital on the parvis was pulled down (May 1874). The houses may have gone earlier: no source gives their own year.",
        "source": "Ville de Paris street names, record 14990 (place Jean-Paul-II); French Wikipedia, Parvis Notre-Dame - place Jean-Paul-II, after Le Monde illustré, 6 June 1874",
        "url": _NOMENCLATURE + "14990",
    },
    {
        "id": "caserne-de-la-cite",
        "until": 1862,
        "site": (PREFECTURE,),
        "reasoned": False,
        "note": "Razed in 1862 for the Cité barracks (decree of 8 August 1860, built 1863-1867), now the Préfecture de police.",
        "source": "vergue.com, Rue de Constantine, after the city's records; Ville de Paris street names, record 15245; French Wikipedia, Préfecture de police (Paris)",
        "url": _VERGUE + "625/Rue-de-Constantine.html",
    },
    {
        "id": "caserne-streets",
        "until": 1862,
        "streets": ("rue aux feves", "rue de la calandre", "rue saint eloi", "rue des cargaisons"),
        "reasoned": False,
        "note": "The rue aux Fèves, the rue de la Calandre, the rue Saint-Éloi and the rue des Cargaisons were razed in 1862 for the Cité barracks (decree of 8 August 1860), now the Préfecture de police.",
        "source": "vergue.com, Rue de Constantine, after the city's records; Ville de Paris street names, record 15245",
        "url": _VERGUE + "625/Rue-de-Constantine.html",
    },
    {
        "id": "marche-aux-fleurs",
        "until": 1866,
        "site": (FLOWER_MARKET,),
        "reasoned": False,
        "note": "Razed in April-July 1866 for the flower market: the rue Gervais-Laurent, the rue Sainte-Croix and what was left of the rue de la Pelleterie.",
        "source": "French Wikipedia, Marché aux fleurs Reine-Elizabeth-II and Rue Gervais-Laurent; vergue.com, Rue Gervais-Laurent and Rue Sainte-Croix, after the city's records",
        "url": _WIKI + "March%C3%A9_aux_fleurs_Reine-Elizabeth-II",
    },
    {
        "id": "tribunal-de-commerce",
        "until": 1859,
        "site": (TRIBUNAL,),
        "reasoned": False,
        "note": "Razed in 1858-1859 for the Tribunal de commerce (built 1860-1865); the bal du Prado, at the corner of the rue de la Pelleterie and the rue de la Barillerie, went in 1858.",
        "source": "vergue.com, Rue de Constantine in 1865, after the city's records; French Wikipedia, Tribunal de commerce de Paris",
        "url": _VERGUE + "153/Rue-de-Constantine-1865.html",
    },
    # Houses under today's streets: the street was widened when the building
    # beside it went up, so they most likely went with the works on that site.
    {
        "id": "street-beside-hotel-dieu",
        "until": 1866,
        "near": (HOTEL_DIEU,),
        "open_space": True,
        "reasoned": True,
        "note": "Under today's street beside the new Hôtel-Dieu: most likely razed with the houses on its site, in 1865-1866. The year is reasoned from those works.",
        "source": "vergue.com, Rue de la Cité and Rue du Cloître-Notre-Dame, after the city's records",
        "url": _VERGUE + "627/Rue-de-la-Cite.html",
    },
    {
        "id": "street-beside-caserne",
        "until": 1862,
        "near": (PREFECTURE,),
        "open_space": True,
        "reasoned": True,
        "note": "Under today's street beside the Cité barracks (now the Préfecture de police): most likely razed with the houses on its site in 1862. The year is reasoned from those works.",
        "source": "vergue.com, Rue de Constantine, after the city's records",
        "url": _VERGUE + "625/Rue-de-Constantine.html",
    },
    {
        "id": "street-beside-marche-aux-fleurs",
        "until": 1866,
        "near": (FLOWER_MARKET,),
        "open_space": True,
        "reasoned": True,
        "note": "Under today's street beside the flower market: most likely razed with the houses on its site in 1866. The year is reasoned from those works.",
        "source": "French Wikipedia, Marché aux fleurs Reine-Elizabeth-II",
        "url": _WIKI + "March%C3%A9_aux_fleurs_Reine-Elizabeth-II",
    },
    {
        "id": "street-beside-tribunal",
        "until": 1859,
        "near": (TRIBUNAL,),
        "open_space": True,
        "reasoned": True,
        "note": "Under today's street beside the Tribunal de commerce: most likely razed with the houses on its site in 1858-1859. The year is reasoned from those works.",
        "source": "vergue.com, Rue de Constantine in 1865, after the city's records",
        "url": _VERGUE + "153/Rue-de-Constantine-1865.html",
    },
]


def _marville(pm_id: str, title: str, streets: tuple[str, ...], dated: str = "between 1865 and 1868") -> dict[str, Any]:
    """A photograph by Charles Marville in the Paris Musées collections (CC0)."""
    return {
        "id": f"parismusees:{pm_id}",
        "year": 1865,
        "streets": streets,
        "title": title,
        "note": f"Still standing in 1865: Marville photographed it, {title} ({dated}; Paris Musées {pm_id}). The houses in the frame are read from the title.",
        "source": f"Charles Marville, {title}, {dated}, Musée Carnavalet (Paris Musées {pm_id}, CC0)",
    }


# Marville's photographs of the old streets of the Cité, taken for the city
# before the works (dates as the Paris Musées notices give them). Each lists
# the 1836 streets whose houses it shows. Rue de la Cité was formed in 1834 from
# rue de la Juiverie, rue de la Lanterne and rue du Marché-Palu; seen from the
# quai aux Fleurs its near end, the old rue de la Lanterne, fills the frame.
PHOTOS: list[dict[str, Any]] = [
    _marville("320002478", "rue Saint-Christophe, seen from the parvis Notre-Dame", ("rue saint christophe",)),
    _marville("320002481", "rue Saint-Christophe, seen from the rue de la Cité", ("rue saint christophe",)),
    _marville("320002496", "rue du Cloître-Notre-Dame, seen from the parvis", ("rue du cloitre notre dame",), "after 1865"),
    _marville("320002222", "rue de la Licorne, seen from the rue de Constantine", ("rue de la licorne",)),
    _marville("320002448", "rue des Trois-Canettes, seen from the rue de la Licorne", ("rue des trois canettes",)),
    _marville("320002450", "rue du Haut-Moulin, seen from the quai aux Fleurs", ("rue du haut moulin",)),
    _marville("320002451", "rue du Haut-Moulin, seen from the rue de Glatigny", ("rue du haut moulin",)),
    _marville("320002469", "rue Gervais-Laurent from a window of the Tribunal de commerce", ("rue gervais laurent",)),
    _marville("320002470", "rue des Marmousets, seen from the rue Saint-Landry", ("rue des marmousets",)),
    _marville("320002472", "rue de Glatigny", ("rue de glatigny",)),
    _marville("320002474", "rue Haute-des-Ursins, seen from the rue Saint-Landry", ("rue haute des ursins",)),
    _marville("320002475", "rue Basse-des-Ursins", ("rue basse des ursins",)),
    _marville("320002476", "rue de la Colombe, seen from the quai", ("rue de la colombe",)),
    _marville("320002499", "rue Chanoinesse, seen from the rue des Chantres", ("rue chanoinesse",)),
    _marville("320002446", "rue Sainte-Croix, seen from the rue de Constantine", ("rue sainte croix",)),
    _marville("320002449", "rue de la Cité, seen from the quai aux Fleurs", ("rue de la lanterne",)),
]

# Tests a clearance may give; a house must pass all of them.
SELECTORS = ("parcels", "site", "streets", "near")


class Dater:
    """Gives each reconstructed house the year it came down, with its source."""

    def __init__(self, parcels: dict[str, Any], facilities: list[tuple[str, Any]], addresses: list[tuple[str, Any]], today: list | None = None):
        """`parcels`: metric parcel geometry by Vasserot id (ID_ALPAGE).
        `facilities`: (APUR name, metric outline). `addresses`: (street key, metric point).
        `today`: metric footprints of the buildings standing today (APUR)."""
        from shapely.strtree import STRtree

        self.today = list(today or [])
        self.today_tree = STRtree(self.today) if self.today else None
        self.facilities = facilities
        self.facility_tree = STRtree([g for _, g in facilities]) if facilities else None
        keys = list(parcels)
        tree = STRtree([parcels[k] for k in keys]) if keys else None
        self.streets: dict[str, set[str]] = defaultdict(set)
        for street, point in addresses:
            if tree is None:
                break
            near = [keys[i] for i in tree.query(point.buffer(ADDRESS_REACH_M))]
            if not near:
                continue
            best = min(near, key=lambda k: parcels[k].distance(point))
            if parcels[best].distance(point) <= ADDRESS_REACH_M:
                self.streets[best].add(street)
        self.counts: dict[str, int] = defaultdict(int)
        # (clearance, photo): houses a dated clearance removes before a photo that seems to show them.
        self.conflicts: dict[tuple[str, str], int] = defaultdict(int)

    def site_of(self, footprint) -> str | None:
        if self.facility_tree is None or not footprint.area:
            return None
        best, share = None, 0.0
        for i in self.facility_tree.query(footprint):
            name, outline = self.facilities[i]
            s = footprint.intersection(outline).area / footprint.area
            if s > share:
                best, share = name, s
        return best if share >= SITE_SHARE else None

    def near_site(self, footprint) -> str | None:
        """The facility whose outline is nearest the house, within NEAR_REACH_M."""
        if self.facility_tree is None:
            return None
        found = [(footprint.distance(self.facilities[i][1]), self.facilities[i][0]) for i in self.facility_tree.query(footprint.buffer(NEAR_REACH_M))]
        found = [f for f in found if f[0] <= NEAR_REACH_M]
        return min(found)[1] if found else None

    def in_open_space(self, footprint) -> bool:
        """True when no building standing today covers most of the house: a street or square took it."""
        if self.today_tree is None or not footprint.area:
            return True
        covered = sum(footprint.intersection(self.today[i]).area for i in self.today_tree.query(footprint))
        return covered / footprint.area < SITE_SHARE

    def _matches(self, c: dict[str, Any], parcel: str, footprint, facts: dict[str, Any]) -> bool:
        def fact(name: str, compute: Callable[[], Any]) -> Any:
            if name not in facts:
                facts[name] = compute()
            return facts[name]

        if "parcels" in c and parcel not in c["parcels"]:
            return False
        if "streets" in c and not fact("streets", lambda: self.streets.get(parcel, set())) & set(c["streets"]):
            return False
        if "site" in c and fact("site", lambda: self.site_of(footprint)) not in c["site"]:
            return False
        if "near" in c and fact("near", lambda: self.near_site(footprint)) not in c["near"]:
            return False
        if "open_space" in c and fact("open_space", lambda: self.in_open_space(footprint)) != c["open_space"]:
            return False
        return True

    def date(self, parcel: str, footprint, quarter: str | None) -> dict[str, Any]:
        """until, until_basis ("dated", "reasoned" or "default") and until_note for one house."""
        if quarter not in CITE_QUARTERS:
            return self._count("default", {"until": DEFAULT_UNTIL, "until_basis": "default"})
        facts: dict[str, Any] = {}
        out = next((c for c in CLEARANCES if self._matches(c, parcel, footprint, facts)), None)
        if out is None:
            life = {"until": DEFAULT_UNTIL, "until_basis": "default"}
            key = "default"
        else:
            life = {
                "until": out["until"],
                "until_basis": "reasoned" if out["reasoned"] else "dated",
                "until_note": out["note"],
            }
            key = out["id"]
        streets = self.streets.get(parcel, set())
        for p in PHOTOS:
            if not streets & set(p["streets"]) or life["until"] > p["year"]:
                continue
            if life["until_basis"] == "dated":
                # The works' own date wins over a street read off a title.
                self.conflicts[(key, p["id"])] += 1
                continue
            life = {"until": p["year"] + 1, "until_basis": "reasoned", "until_note": p["note"]}
            key = p["id"]
            break
        return self._count(key, life)

    def _count(self, key: str, life: dict[str, Any]) -> dict[str, Any]:
        self.counts[key] += 1
        return life


def load_addresses(bbox, to_metric) -> list[tuple[str, Any]]:
    """Vasserot's address points (street key, metric point) inside the bbox."""
    from shapely.geometry import Point

    path = paths.REPO_ROOT / "pipeline" / "cache" / "vasserot-1836.json"
    streets = json.loads(path.read_text(encoding="utf-8"))["streets"]
    out = []
    for key, entries in streets.items():
        for e in entries:
            for lon, lat in e["numbers"].values():
                if bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]:
                    out.append((key, Point(*to_metric(lon, lat))))
    return out


def load_facilities(bbox, to_metric, log: Callable[[str], Any]) -> list[tuple[str, Any]]:
    """Every facility outline in the bbox, in metres (APUR).

    All are kept, not only those CLEARANCES names, so that a house beside
    the Palais is not dated by the Tribunal across the street."""
    from shapely.geometry import shape
    from shapely.ops import transform

    from rpr.sources.landmarks import fetch_equipment  # imported here: landmarks imports this package's model3d

    out = []
    for f in fetch_equipment(tuple(bbox)):
        name = f["properties"].get("l_ee_maj")
        if name and f.get("geometry"):
            g = transform(to_metric, shape(f["geometry"]))
            out.append((name, g if g.is_valid else g.buffer(0)))
    wanted = {n for c in CLEARANCES for n in c.get("site", ()) + c.get("near", ())}
    missing = wanted - {n for n, _ in out}
    if missing:
        log(f"clearances: no APUR outline for {sorted(missing)}; their houses fall back on streets or the default")
    return out


def summary(counts: dict[str, int]) -> list[dict[str, Any]]:
    """The clearances and photos with the number of houses each dated, for the file's metadata."""
    rows = []
    for c in CLEARANCES + PHOTOS:
        if counts.get(c["id"]):
            row = {k: c[k] for k in ("id", "until", "note", "source", "url") if k in c}
            if "year" in c:  # a photo: its houses stand at least until the year after
                row["until"] = c["year"] + 1
            rows.append(row | {"reasoned": c.get("reasoned", True), "houses": counts[c["id"]]})
    return rows
