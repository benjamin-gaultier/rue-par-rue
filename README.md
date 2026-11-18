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
| Ochre: standing in 1836, demolished since | Vasserot cadastre parcels, cut back where a surviving building stands. No 1836 building footprints exist, so parcels over 400 m² become a 9 m-deep ring around a courtyard, parcels over 160 m² are split into lots of about 9 m (one house each, each with its own height), open spaces (parvis, squares, markets) are left out, and heights are estimated at 12–19 m | until 1860 |
| Grey: built later | APUR footprints and heights, appearing from their construction period | from that period |

It is a massing model to judge scale and density, labelled as a reconstruction in the app. Drag past 1860 to see Haussmann clear the island, and click any building for its sources.

#### The detailed area around Notre-Dame

About 600 m around the cathedral (`focus` in `AREAS`, about 2,000 buildings across all years) is drawn by `web/src/city3d.ts` instead of plain blocks: a three.js layer in the map's WebGL context, with geometry from `web/src/citygen.ts` and procedural shaders in `web/src/cityshaders.ts`. Nothing is downloaded beyond the model: storeys, windows, shutters, shopfronts, balconies, dormers, tiles and zinc are drawn by the shaders, and fade to an average colour with distance.

- **Facades by age.** Houses standing in 1836 get plaster in varied colours, narrow window bays, shutters and painted wooden shopfronts. Buildings of 1851–1914 get cut stone, a rusticated ground floor with arched openings, and balconies on the second and fifth floors. Later buildings get plainer, wider windows. Walls that touch a neighbour standing at the same time are left blind, as Paris gable walls are. Up close, windows are recessed (the reveals shift as you walk past), with casements, shutters and iron guards; cornices, string courses and the Haussmann balconies with their railings are real relief, and some old houses overhang the street from the first floor. Ground floors have shops with painted casings (from the early 19th century), awnings (from about 1850), fascia lettering by trade and year, projecting signs, doors and carriage doors, and house numbers: painted (1790s), on an ochre ground (1805), on blue enamel (1847). High blind walls carry painted advertisements (about 1880–1960, fading after); shopfronts modernise from the 1950s. Lettering is drawn on a canvas at load (`web/src/signs.ts`); layout rules shared by geometry and shaders are in `web/src/facades.ts`.
- **Roofs from APUR.** `c_forme_toit` gives the shape: brisis-terrasson becomes a mansard with dormers lined up on the windows below, two-pitch roofs a ridge along the footprint's long axis, flat roofs a terrace. `c_toiture_mat` gives tile, zinc, stone or planting. Demolished houses get tile roofs with gables; chimney stacks with terracotta pots rise from party walls. Mansard dormers are geometry, and mansards rise straight from party walls.
- **Notre-Dame.** Towers come from APUR (about 67 m). The west front is laid out along the line across the cathedral's westernmost points: three portals, the gallery of kings, the rose window between two traceried windows, the great gallery and the belfries. The spire stands from 1860 (Viollet-le-Duc), is missing from April 2019 and back in 2024.
- **The river.** `python -m rpr site --area cite` fetches the Seine from IGN BD TOPO with its water level (27 m, against 34 m in the streets), so the river sits 7 m down between stone quays. Bridge decks come from the BD TOPO road segments marked as bridges; their side walls are pierced by arches. Streets and squares are paved with sandstone setts.
- **Gardens and trees.** `python -m rpr greenery --area cite` takes the 1,038 trees in the area from the City of Paris tree register (species, height, girth) and the garden outlines from APUR. Neither has dates, so the dates are reasoned:
  - Gardens open in the year their history gives (square Jean-XXIII 1844, square de l'Île-de-France 1914, square René-Viviani 1928…). Five small gardens with no source found are shown from 1950 and flagged in the data.
  - Trees in a garden are planted when it opens, street trees with the Second Empire's tree-lined quays (from 1855).
  - No tree grows inside a building standing that year, so trees on the site of demolished houses are planted after 1860.
  - Trees grow with the slider: young when planted, full size after about 40 years.
  - Lawns sit inside cast-iron railings. Plane trees, chestnuts, poplars, limes and conifers each have their own shape, colour and bark, and cast a soft shadow.
- **Walking.** The river blocks the way except on the bridges.
- **The year is a shader uniform**, so dragging the slider costs nothing: buildings that do not stand that year are dropped on the GPU.

Facades are generated, not surveyed: they show the character of each period, not the real windows of each house.

#### Photos in 3D and walking the streets

In the 3D view the archive photographs stand as picture frames where they were taken, from the years around the one you pick. Buildings hide the frames behind them, the frames turn to face you, and photos sharing a spot become one frame with a count. Click a frame to open the photo.

**Walk the streets** puts the camera about 2 m above the ground. Use the arrow keys or W A S D (Shift to go faster) and drag to look around and up. Buildings standing in the chosen year block the way, so changing the year changes the streets you can walk; if a building appears where you stand, you step out to the nearest open ground. Looking above the horizon uses MapLibre's experimental pitch beyond 90° with an unclamped camera centre.

WebGL can only draw images served with CORS headers. Albert-Kahn images load from the museum's portal; Paris Musées images come from small same-origin thumbnails (`python -m rpr thumbs --area cite`, 682 images, 4.5 MB, CC0).

#### 3D photos (AI depth)

`python -m rpr depth --set notre-dame` (needs `pip install -e ".[depth]"`) runs **Depth Anything V2 Small** (Apache 2.0, ONNX export by onnx-community, on CPU) on the 89 photos of Notre-Dame within 350 m of the cathedral: 78 Albert-Kahn autochromes and 11 Paris Musées prints. Paris Musées scans show the whole mounted card, so each print is cut out of its mount first. Each photo gets an 8-bit depth map (white = near), stored in `web/public/data/3d/depth/`.

In the app these photos get a **View as a 3D photo** button: the photo becomes a relief that shifts with the pointer, like looking through a window. In the 3D streets their frames become reliefs too, and they are shown first where several photos share a spot. The mesh is torn at sharp depth edges so foreground and background stay apart.

The depth is relative and estimated from a single image. It gives parallax, not a measured model, and the app says so.

#### Footprints traced from Vasserot's plans

`python -m rpr trace --area cite` (needs `pip install -e ".[geo,vision]"`) traces real building footprints from Vasserot's ground-floor plans, one coloured sheet per building, published by the Archives nationales under the Licence Ouverte 2.0:

1. Each sheet is matched to its parcel through the ALPAGE 1836 address points (street, number, quarter).
2. The drawing is segmented in Lab colour, relative to the sheet's own paper: the pink wash marks built rooms, white areas closed by boundary lines are courtyards. Sheets that colour only the walls are flagged `walls_only`.
3. The drawing is registered onto the parcel polygon (scale from areas, rotation searched to 0.25°, scored by IoU). Fits below 0.72 are rejected.

On the Cité: 169 sheets with a street number, 57 traced (median IoU 0.82), 42 rejected for a poor fit, 63 without an address match, 7 with no detectable drawing. Traced buildings are shown in terracotta, with a link to the original sheet. Output: `web/public/data/3d/vasserot-traced-cite.geojson`.

Next: better address matching (renamed streets, number ranges), the Vasserot block atlas for full coverage, roof shapes, and facade textures from the archive photographs.

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
4. **Phase 4, 3D**: the Île de la Cité as a massing model, with footprints traced from Vasserot's plans, photos in the streets, an eye-level walk, and a detailed area around Notre-Dame (see above). Next: the Hôtel-Dieu and the archbishop's palace of 1836, photo-textured landmark facades, then more quarters.

## Licences

Code: MIT. Data keeps its source licence; see [DATA_SOURCES.md](DATA_SOURCES.md). The Vasserot data is ODbL, so derived databases that include it are shared under the ODbL.
