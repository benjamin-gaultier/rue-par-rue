# Rue par Rue

A street view of Paris through time. Drag a year slider from 1790 to today: the map changes to the survey or aerial photograph of that period, the 1810–1836 cadastre shows the city before Haussmann, and archive photographs appear where they were taken. Select a photograph to see the same spot today in Panoramax street-level imagery.

Everything shown comes from public archives. Nothing on the map is generated.

## What works now (phases 1 and 2)

| Layer | Years | Source |
| --- | --- | --- |
| Verniquet atlas, 72 sheets warped onto the map with Allmaps | 1785–1791 | David Rumsey Map Collection scans, SoDUCo control points (CC0) |
| Vasserot cadastre: streets, blocks, parcels (vector tiles) | 1810–1836 | ALPAGE via Stanford Libraries (ODbL) |
| Carte de l'état-major | 1820–1866 | IGN Géoplateforme |
| Topographic map of the Paris area | 1906 | IGN Géoplateforme |
| Aerial photographs of Paris | 1949, 1965 | IGN Géoplateforme |
| Aerial photograph mosaics | 2000–2023 | IGN Géoplateforme |
| Plan IGN | today | IGN Géoplateforme |
| Today's street-level photos, by place | 2014–today | Panoramax API |
| Archive photographs: Marville, Atget | 1850s–1920s | Paris Musées (CC0), placed by geocoding their captions |
| Archive photographs: Albert-Kahn autochromes | 1910s–1930s | Pipeline ready; run the harvest workflow (see below) |

After 1860 the cadastre turns into an orange ghost over later maps, so streets cut by Haussmann's works stay visible. The URL hash keeps the year, view and selected photo, so any view can be shared.

### Then and now

Select a photograph and choose **Compare then and now**. The archive photo opens over a Panoramax picture of the same place:

- **360° panoramas** (Photo Sphere Viewer): the archive photo stays at the centre of the screen and you turn the panorama underneath it until the two line up. Its width follows the zoom, using the rectilinear field of view, so alignment holds while zooming.
- **Flat street photos**: drag the archive photo over today's picture.
- A **Now ↔ Then** slider blends the two, **Hold to see then** shows the archive alone, and **Size** sets the archive photo's field of view.
- The alignment (Panoramax picture, bearing, pitch, field of view) is saved in the URL as `a=…`, so **Copy link** shares exactly what you lined up.

The archive photo is drawn as a plain image above the panorama, not as a WebGL texture, so it works with archives that send no CORS headers (Paris Musées). The viewer and three.js load only when it is first opened.

### 3D prototype: the Île de la Cité

Choose **Île de la Cité in 3D** to fly over the island in 1836, then drag the year. The model (`python -m rpr model3d --area cite`) combines:

| Shown as | Source | Years shown |
| --- | --- | --- |
| Cream: standing in 1836 and still standing | APUR building footprints dated before 1851, with their measured median heights (Notre-Dame's towers come out at about 70 m) | always |
| Ochre: standing in 1836, demolished since | Vasserot cadastre parcels not covered by a surviving building. No 1836 building footprints exist, so parcels over 400 m² become a 9 m-deep ring around a courtyard, open spaces (parvis, squares, markets) are left out, and heights are estimated at 12–19 m | until 1860 |
| Grey: built later | APUR footprints and heights, appearing from their construction period | from that period |

It is a massing model to judge scale and density, labelled as a reconstruction in the app. Drag past 1860 to see Haussmann clear the island. Next steps: real footprints from the Vasserot block plans, roof shapes, and facade textures from the archive photographs.

## Repository layout

```
web/        Vite + TypeScript + MapLibre GL app (static, no backend)
  public/data/   generated data the app reads (committed)
pipeline/   Python package `rpr` that harvests and normalises sources
.github/    CI, a manual harvest workflow, GitHub Pages deploy
```

## Run the app

```sh
cd web
npm ci          # .npmrc sets legacy-peer-deps (works around an npm bug with vitest's optional peers)
npm run dev     # http://localhost:5173
npm test        # unit tests
npm run build   # static site in web/dist
```

## Run the pipeline

Python 3.11+, standard library only (pytest for tests).

```sh
cd pipeline
pip install -e ".[dev]"
python -m rpr verniquet     # Verniquet georeference annotations, with real IIIF image sizes
python -m rpr vasserot      # Vasserot PMTiles from Stanford
python -m rpr kahn          # Albert-Kahn Paris photos (see note)
python -m rpr parismusees   # Paris Musées photos, needs PARISMUSEES_TOKEN
python -m rpr index         # rebuild photos.geojson + manifest.json
pytest -q
```

Paris Musées records carry no coordinates, so `rpr/geocode.py` reads the caption ("Passage de l'Opéra, vue prise de la rue Lepeletier, 9ème arrondissement"), prefers the street the view was taken from, and looks it up in the national address base through the IGN Géoplateforme geocoder. Only matches scoring 0.8 or more inside the stated arrondissement are kept, so renamed or demolished streets stay unplaced rather than misplaced. Positions are street-level approximations (`pose: geocoded`, low confidence) until phase 3 refines them. Lookups are cached in `pipeline/cache/geocode.json`.

Every photo source is normalised into one schema (`pipeline/rpr/photo.py`): position, date range, image links, licence, credit, and how the camera position was obtained (`recorded`, `geocoded`, `matched`, `manual`, `estimated`) with a confidence score. Records outside Paris, with impossible dates or without an image are rejected and counted in `manifest.json`.

### Harvest from GitHub Actions

The Opendatasoft portals that publish the Albert-Kahn data reset connections from some cloud sandboxes. Run **Actions › Harvest** with `source: kahn` instead. It commits the result to the branch it ran on. Tick `inspect` first to print the live field names.

For Paris Musées, create a free token at <https://apicollections.parismusees.paris.fr/> and add it as the repository secret `PARISMUSEES_TOKEN`.

## Deploy

`.github/workflows/pages.yml` publishes `web/dist` to GitHub Pages on every push to `main`. Enable it once under Settings › Pages › Source: GitHub Actions.

## Roadmap

1. **Phase 1, time-slider map** (this release): basemap timeline, cadastre, Panoramax "today" view, photo pipeline.
2. **Phase 2, then-and-now viewer** (this release): archive photo over the nearest Panoramax panorama, with alignment saved in the URL.
3. **Phase 3, pose refinement**: geocode Marville and Atget captions against historical street names and the 1836/1888 street networks; infer headings (Kahn records have positions but no direction, so the viewer cannot yet face the subject automatically); refine poses by matching against Panoramax imagery; let people submit the alignments they make in the viewer.
4. **Phase 4, 3D**: a prototype over the Île de la Cité is in place (see above). Next: building footprints traced from the Vasserot block plans, roof shapes, facade textures, an eye-level walk, then more quarters.

## Licences

Code: MIT. Data keeps its source licence; see [DATA_SOURCES.md](DATA_SOURCES.md). The Vasserot data is ODbL, so derived databases that include it are shared under the ODbL.
