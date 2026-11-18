# Data sources

| Data | Where it comes from | Licence | Credit to show | How we get it |
| --- | --- | --- | --- | --- |
| Verniquet, *Plan de la ville de Paris* (1785–1791), 72 sheets | Scans: David Rumsey Map Collection (IIIF Image API 2). Control points: SoDUCo project, Harvard Dataverse [doi:10.7910/DVN/ZKRJFA](https://doi.org/10.7910/DVN/ZKRJFA) | Control points CC0 1.0. Scans: see David Rumsey terms | "Verniquet atlas: David Rumsey Map Collection · georeferencing: SoDUCo" | `rpr verniquet` rewrites the annotations to the current Georeference Annotation format and reads true image sizes from each `info.json`. Images load from Rumsey's IIIF server at view time. |
| Vasserot cadastre (1810–1836): street space, blocks, parcels | ALPAGE project; Stanford Libraries [gy980ch3900](https://purl.stanford.edu/gy980ch3900), [bz020fp6123](https://purl.stanford.edu/bz020fp6123), [qr091wq2775](https://purl.stanford.edu/qr091wq2775) | ODbL 1.0 | "Arch. nat. F31 73-96, Arch. Paris, © ALPAGE" | `rpr vasserot` copies the published PMTiles files. |
| Carte de l'état-major (1820–1866), carte topographique (1906), aerial photographs (1949, 1965, 2000–2023), Plan IGN | IGN Géoplateforme WMTS (`data.geopf.fr`) | Free reuse, including commercial (IGN open data terms) | "© IGN – Géoplateforme" | Tiles load directly in the browser. Layer names are in `web/src/timeline.ts`. |
| Albert-Kahn, Archives de la Planète, Paris (about 5,000 items) | Hauts-de-Seine open data, dataset `archives-de-la-planete-paris` | Per item: CC0, CC BY or not reusable, according to the Musée départemental Albert-Kahn terms. The data.gouv.fr record lists no licence: check before reuse outside this project. | "Musée départemental Albert-Kahn, Département des Hauts-de-Seine" | `rpr kahn` (run from GitHub Actions). |
| Paris Musées collections (Marville, Atget, …) | Paris Musées GraphQL API | CC0 for public-domain works (records flagged `fieldImageLibre`) | "Paris Musées / Musée Carnavalet" | `rpr parismusees` (needs a free token). Images are linked from the collections site, not copied. |
| Building footprints, construction periods and heights (3D model) | APUR, `EMPRISE_BATIE_PARIS` (ArcGIS service on carto2.apur.org) | ODbL | "APUR" | `rpr model3d` queries the model area only. |
| The Seine, its water level and bridge decks (detailed 3D area) | IGN BD TOPO via the Géoplateforme WFS (`BDTOPO_V3:surface_hydrographique`, `BDTOPO_V3:troncon_de_route`) | Licence Ouverte / Etalab 2.0 | "IGN BD TOPO" | `rpr site` writes `web/public/data/3d/site-cite.geojson`. Today's bridges stand in for those of 1836, which crossed on the same lines. |
| Street and garden trees (detailed 3D area) | Ville de Paris, "Les arbres" (Paris Data, `les-arbres`) | ODbL | "Ville de Paris" | `rpr greenery` writes `web/public/data/3d/greenery-cite.json`. No planting dates in the data: they are reasoned (see README). |
| Period vehicles and boats (3D area) | Street space: Vasserot cadastre, `Vasserot_Emprise_de_la_voirie` (ALPAGE via Stanford Libraries [gy980ch3900](https://purl.stanford.edu/gy980ch3900), shapefile). Streets, bridges and river: IGN BD TOPO (`troncon_de_route`, `surface_hydrographique`) | ODbL (Vasserot), Licence Ouverte / Etalab 2.0 (BD TOPO) | "© ALPAGE", "IGN BD TOPO" | `rpr vehicles` writes `web/public/data/3d/vehicles-cite.json`. Types and years come from the archive photographs and transport history (see README); positions are plausible, not recorded. |
| Garden outlines (detailed 3D area) | APUR, `EQUIPEMENT_EMPRISE`, category 151 (parks, gardens, squares) | ODbL | "APUR" | Opening years come from the City of Paris history panels and pages, listed in `rpr/sources/greenery.py`. |
| Vasserot parcels for the 3D model | ALPAGE via Stanford Libraries ([qr091wq2775](https://purl.stanford.edu/qr091wq2775)), Lambert I (EPSG:27561) shapefile | ODbL | "Arch. nat. F31 73-96, Arch. Paris, © ALPAGE" | `rpr model3d` reprojects with pyproj (`pip install -e ".[geo]"`). |
| Vasserot ground-floor plans, one sheet per building (1809–1854) | Archives nationales, "Plans cadastraux des immeubles de Paris 1809-1856" (index CSV on data.gouv.fr, images on siv.archives-nationales.culture.gouv.fr) | Licence Ouverte 2.0 | "Archives nationales" plus the sheet's call number | `rpr trace` downloads the sheets for the model area (not committed) and publishes the traced footprints. |
| Vasserot address points (1810–1836) | ALPAGE via Stanford Libraries ([pn650tp5621](https://purl.stanford.edu/pn650tp5621)) | ODbL | "© ALPAGE" | Used by `rpr trace` to match sheets to parcels. |
| Thumbnails for 3D photo frames | Paris Musées images in the 3D area, resized to 224 px | CC0 | "Paris Musées / Musée Carnavalet" | `rpr thumbs`, stored in `web/public/data/3d/thumbs/`. |
| Depth maps for 3D photos (Notre-Dame set) | Computed with Depth Anything V2 Small (Apache 2.0) from the archive photos | Model: Apache 2.0. Depth maps follow the photo's licence | "Depth estimated by Depth Anything V2 Small" | `rpr depth`, stored in `web/public/data/3d/depth/` (Paris Musées images copied there, cropped from their mounts, CC0). |
| Street positions for captions | IGN Géoplateforme geocoder (Base Adresse Nationale) | Licence Ouverte / Etalab 2.0 | "Base Adresse Nationale, IGN" | `rpr/geocode.py`, cached in `pipeline/cache/geocode.json`. |
| Street-level photos today | Panoramax (IGN and OpenStreetMap France instances) | CC BY-SA 4.0 or Etalab 2.0, per photo | "Panoramax contributors" plus the photo's licence | Queried in the browser by place (`place_position`). |

## Checked but not used yet

- **Gallica (BnF)** IIIF: rich in Atget prints, postcards and plans. Commercial reuse of images is paid.
- **Albert-Kahn films** (21 Paris films in the same dataset).
- **SoDUCo trade directories** (1787–1914, geocoded): planned for shop names on the 1836 facades.
- **APUR building construction periods**: planned for hiding buildings that did not exist yet.
- **Paris former street names** (*dénominations caduques*): planned for geocoding captions.
- **IGN 1980–1995 mosaic**: no tiles over central Paris.
- **État-major 1:10,000 "environs de Paris"**: leaves the city itself blank.
