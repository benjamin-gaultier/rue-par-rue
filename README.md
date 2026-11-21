# Rue par Rue

A street view of Paris through time. Drag a year slider from 1790 to today: the map changes to the survey or aerial photograph of that period, the 1810–1836 cadastre shows the city before Haussmann, and archive photographs appear where they were taken. Select a photograph to see the same spot today in Panoramax street-level imagery.

Everything shown comes from public archives. Where the 3D view reconstructs or generates what no archive shows, it says so, and names the sources it worked from.

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

#### The detailed island

The whole Île de la Cité and the quays facing it are drawn by `web/src/city3d.ts` instead of plain blocks: the islands and every bank within 90 m of the Seine inside the model box (`focus` and `focus_river_m` in `AREAS`, computed by `site.focus_area`), 3,331 buildings across all years, plus the houses on the bridges. The streets behind the quays stay plain blocks. It is a three.js layer in the map's WebGL context, with geometry from `web/src/citygen.ts` and procedural shaders in `web/src/cityshaders.ts`. Nothing is downloaded beyond the model: storeys, windows, shutters, shopfronts, balconies, dormers, tiles and zinc are drawn by the shaders, and fade to an average colour with distance.

- **Facades by age.** Houses standing in 1836 get plaster in varied colours, narrow window bays, shutters and painted wooden shopfronts. Buildings of 1851–1914 get cut stone, a rusticated ground floor with arched openings, and balconies on the second and fifth floors. Later buildings get plainer, wider windows. Walls that touch a neighbour standing at the same time are left blind, as Paris gable walls are. Up close, windows are recessed (the reveals shift as you walk past), with casements, shutters and iron guards; cornices, string courses and the Haussmann balconies with their railings are real relief, and some old houses overhang the street from the first floor. Ground floors have shops with painted casings (from the early 19th century), awnings (from about 1850), fascia lettering by trade and year, projecting signs, doors and carriage doors, and house numbers: painted (1790s), on an ochre ground (1805), on blue enamel (1847). High blind walls carry painted advertisements (about 1880–1960, fading after); shopfronts modernise from the 1950s. Lettering is drawn on a canvas at load (`web/src/signs.ts`); layout rules shared by geometry and shaders are in `web/src/facades.ts`.
- **Roofs from APUR.** `c_forme_toit` gives the shape: brisis-terrasson becomes a mansard with dormers lined up on the windows below, two-pitch roofs a ridge along the footprint's long axis, flat roofs a terrace. `c_toiture_mat` gives tile, zinc, stone or planting. Demolished houses get tile roofs with gables; chimney stacks with terracotta pots rise from party walls. Mansard dormers are geometry, and mansards rise straight from party walls.
- **Notre-Dame.** Towers come from APUR (about 67 m). The west front is laid out along the line across the cathedral's westernmost points: three portals, the gallery of kings, the rose window between two traceried windows, the great gallery and the belfries. The spire stands from 1860 (Viollet-le-Duc), is missing from April 2019 and back in 2024.
- **The river.** `python -m rpr site --area cite` fetches the Seine from IGN BD TOPO with its water level (27 m, against 34 m in the streets), so the river sits 7 m down between stone quays. The ground box is the focus box plus about 90 m, where the detail fades out, so paving, river, quay walls and trees cover the whole island and the facing quays. Streets and squares are paved by year (see Streets through time below). Each bridge stands only in the years it stood (see below).
- **Gardens and trees.** `python -m rpr greenery --area cite` takes the 2,493 trees in the ground box from the City of Paris tree register (species, height, girth) and the garden outlines from APUR. Neither has dates, so the dates are reasoned:
  - Gardens open in the year their history gives (square Jean-XXIII 1844, square de la Tour-Saint-Jacques 1856, square du Vert-Galant 1884, square de l'Île-de-France 1914, square René-Viviani 1928…). Gardens with no source found (the place Dauphine's among them, and small ones at the edge) are shown from 1950 and flagged in the data.
  - Trees in a garden are planted when it opens, street trees with the Second Empire's tree-lined quays (from 1855).
  - No tree grows inside a building standing that year, so trees on the site of demolished houses are planted after 1860.
  - Trees grow with the slider: young when planted, full size after about 40 years.
  - Lawns sit inside cast-iron railings. Plane trees, chestnuts, poplars, limes and conifers each have their own shape, colour and bark, and cast a soft shadow.
- **The great institutions of the old Cité.** The 1836 cadastre names the parcels of the Hôtel-Dieu, the archbishop's palace and the Enfants-Trouvés but draws no buildings in them, and the Archives nationales hold no building sheets for them. Verniquet's atlas (surveyed 1785–1791) does: built areas are hatched. `pipeline/scripts/capture_verniquet.cjs` saves screenshots of the atlas as the app shows it (georeferenced by SoDUCo, warped by Allmaps), and `python -m rpr institutions --area cite` finds the hatching, keeps it inside each institution's 1836 parcel and out of today's river, and dates it:
  - the Hôtel-Dieu: wards on the island until 1878 (demolished once the new Hôtel-Dieu opened north of the parvis), the annex on the left bank until 1909 (its site became the square René-Viviani). Wards built over the river are left out: their dates are not known;
  - the Enfants-Trouvés by Boffrand (1746–1748) on the parvis, until the works of the 1870s;
  - the archbishop's palace and its terraced gardens until February 1831, when a mob sacked and burned it; its blackened, roofless shell until it was razed after the law of June 1837.

  `model3d` uses these footprints in place of house lots, and `web/src/institutions.ts` gives them classical stone facades (`institutionshaders.ts`) and slate mansards. Footprints are those of about 1790, used until each demolition.
- **Walking.** The river blocks the way except on the bridges standing that year, houses on the bridges block it too, and walking stops 60 m inside the ground box, before the detail fades (`web/src/island.ts`).
- **Landmarks through time.** `python -m rpr landmarks --area cite` (run after `model3d`) finds the landmark buildings of the model by name, in APUR's register of public facilities (Palais de Justice, Conciergerie, Sainte-Chapelle, Tribunal de commerce, Préfecture de police, Hôtel-Dieu, flower market), and by location in IGN BD TOPO (the round towers, the dome). It writes their facade styles, their dates and the parts no footprint holds to `web/public/data/3d/landmarks-cite.json`; `web/src/landmarks.ts` draws them (three merged meshes, facades in `web/src/landmarkshaders.ts`). Sources and reasoning, also in `pipeline/rpr/sources/landmarks.py`:
  - *Sainte-Chapelle*, drawn in full on its APUR footprint: 36 × 17 m and 42.5 m to the ridge (eaves at 28 m, reasoned), four bays of tall windows and a seven-sided apse between buttresses with pinnacles, gablets, the two-storey west porch, the flamboyant rose, turrets, a gilt crest. The medieval spire stands until 1791 (the usual date; Hérodote gives 1793–94), Lassus's spire from 1855 (built 1853–1855, 33 m above the ridge, about 75.75 m). The earlier spire is drawn with the same shape, since Lassus followed its 15th-century design.
  - *Conciergerie*: from the boulevard du Palais, the Tour de l'Horloge (about 1350, 47 m, a steep roof and the clock dial of 1585), then the Tour César, the Tour d'Argent and the Tour Bonbec. Bonbec is raised by a storey and crenellated from 1858, with the gothic-revival front on the quai de l'Horloge ("the fortress-like appearance only dates from about 1858", Structurae). The round towers' heights are reasoned from APUR's maximum heights around them.
  - *Palais de Justice*: Duc's west front on the rue de Harlay from 1868 (foundations 1857, assize halls finished 1868). Other wings keep APUR's dates (1851–1914, given as 1900). The old Palais and the houses it absorbed (Vasserot) stand until the wing built on their site, instead of all going in 1860.
  - *Tribunal de commerce* (Bailly, 1860–1865) from 1865, with its octagonal dome on the axis of the boulevard de Sébastopol; *Préfecture de police* (caserne de la Cité, Calliat, 1863–1867) from 1867; the new *Hôtel-Dieu* (Gilbert and Diet, 1866–1877) from 1877, with the undated buildings in its courtyards.
  - *Henri IV on the Pont Neuf*: the first bronze (1614) until 1792, with the four captives on its pedestal; Lemot's bronze from its inauguration on 25 August 1818. Both face the place Dauphine (sources disagree on this). Low-poly, larger than life on a pedestal of about 4 m: sizes are an estimate.
  - *Place Dauphine* (1607–1616): the two houses at the entrance keep their brick and stone; the houses of the east side, along the rue de Harlay, stand until 1874.
  - *The morgue*: on the quai du Marché-Neuf by the Pont Saint-Michel from 1804, on the quai de l'Archevêché at the eastern point from 1864 until it moved to the quai de la Rapée in 1914 (the square de l'Île-de-France was laid out on its site). No plans were found: both are low buildings placed and sized by reasoning.
  - *Flower market*: stalls on the quai Desaix from 1809 (outline from the Vasserot cadastre, cut back where the Tribunal de commerce goes up), six iron pavilions of 1873, stalls again during the Métro works (the Cité station opened in 1910, a reasoned gap), today's low pavilions from 1924 (some were added in 1928).
  - *Notre-Dame*: flying buttresses placed from the APUR footprints, one per bay along the nave and choir and radiating round the apse, with piers and pinnacles; the aisles get low roofs so the flyers clear them.
- **The year is a shader uniform**, so dragging the slider costs nothing: buildings that do not stand that year are dropped on the GPU.

Facades are generated, not surveyed: they show the character of each period, not the real windows of each house.

#### Bridges through time

Every bridge touching the island is drawn as the succession of structures that stood there, each only in its years (`BRIDGES` in `pipeline/rpr/sources/site.py`, geometry in `web/src/bridges.ts`, shading in `web/src/bridgeshaders.ts`). Today's BD TOPO decks stand in for the older bridges' plans: one deck per crossing (two for the Pont Neuf), same line and length; the width changes only where the history gives one. The kinds look their period: old stone bridges with round arches, thick piers and pointed cutwaters; 19th-century masonry with elliptical arches, slender piers and a cornice; iron arches with ribs, spandrel struts and cast-iron railings; suspension footbridges with masonry pylons, chains and hangers; a timber bridge; a steel lattice footbridge; a steel girder. Masonry arches are closed by vaults.

| Bridge | Structures shown (years on the slider) | Sources |
| --- | --- | --- |
| Pont Neuf | Stone, 7 + 5 round arches (built 1578–1607) | Structurae |
| Pont au Change | Stone bridge of 1639–1647 with two rows of houses until 1788 (cleared 1786–1788), until 1858 · three elliptical arches of 31 m from 1860 (1858–1860) | Structurae; paperblog.fr; Hubert Robert's paintings (Carnavalet) |
| Pont Notre-Dame | Stone bridge of 1500–1507 carrying 68 houses, until 1853; the houses until 1787 (demolition ordered 1786, done 1786–1787) · five arches 1853–1919 · two stone arches around a 60 m iron arch from 1919 (decided 1912) | techno-science.net; sortiraparis.com; Structurae |
| Petit-Pont | Stone, rebuilt without houses after the fire of 1718, until 1853 · one stone arch from 1853 | *Dictionnaire administratif et historique des rues de Paris* (Wikisource); Wikipedia |
| Pont au Double | Stone (1634, rebuilt after its collapse in 1709) until 1847 · one masonry span of 31 m 1848–1883 · cast-iron arch from 1883 | Structurae |
| Pont Saint-Michel | Stone bridge of 1616 with 32 houses, until 1857; the houses until 1808 (imperial decree of 1807) · three round arches from 1857 | evous.fr; Wikipedia |
| Pont d'Arcole | Suspension footbridge, two spans, 3.5 m wide, 1828–1854 · wrought-iron arch of 80 m from 1856 (decree of 1854) | paris.fr; Structurae |
| Pont Saint-Louis | Timber pont Rouge (1717) until 1795 · pont de la Cité, two arches, 1804–1811 · suspension footbridge 1842–1861 · iron arch of 64 m 1862–1939 (sunk 22 December 1939) · lattice footbridge 1941–1968 · steel bridge from 1970 | Structurae; list of Paris bridges (Wikipedia) |
| Pont de l'Archevêché | Three masonry arches of 15, 17 and 15 m, from 1828 | Structurae; waymarking.com |
| Pont Louis-Philippe | Two-span suspension bridge from the right bank to the quai aux Fleurs over the point of the Île Saint-Louis, 1834–1860, on its own line · three masonry arches on today's line, from 1862 | Structurae; Wikipedia; stereotheque.fr |
| Pont de la Tournelle (in view, from the Île Saint-Louis) | Stone, six round arches (1656), until 1918 · concrete faced with stone, arches of 12, 74 and 11 m, from 1928 | parisjetaime.com; pariszigzag.fr; Structurae |

**Houses on the bridges** stand on the Pont Notre-Dame, the Pont au Change and the Pont Saint-Michel from 1780 until they were cleared: rows of narrow houses on both sides of the roadway with the old-house facade (style 0) and tile gable roofs, at least 6 m of street between them, the parapet left out while they stand. They block the way when walking, and their popup says when they went.

What is estimated, not sourced:

- The arch counts of the old bridges (Pont au Change 7, Pont Notre-Dame 6, Petit-Pont 3, Pont au Double 2, Pont Saint-Michel 4, pont Rouge 3) and the widths of the footbridges (except the Pont d'Arcole's 3.5 m).
- Arch shapes follow the kind, not each bridge: spans are equal (or one wide centre), and decks are level.
- The line of the first Pont Louis-Philippe: from the quai aux Fleurs through the north-west point of the Île Saint-Louis, as the sources describe it; the landing places are estimated.
- House fronts are at least 3.4 m and today's decks are shorter than the old bridges, so 56 of the Pont Notre-Dame's 68 houses fit; the Pont au Change gets 44 (no count found), the Pont Saint-Michel its 32. Heights are 14 m alike on the Pont Notre-Dame, 12–17 m elsewhere.
- Years of works are left empty where a source dates them (the Pont d'Arcole 1854–1856, the Pont au Change 1858–1860, the Pont Saint-Louis 1939–1941 and 1968–1970, the Pont Louis-Philippe 1860–1862, the Tournelle 1918–1928); elsewhere one structure gives way to the next in the year of the change (the Pont Notre-Dame's iron centre is shown from its opening in 1919).
- Not drawn: the Hôtel-Dieu's rooms over the Pont au Double and its Pont Saint-Charles (left to the Hôtel-Dieu model), the Samaritaine pump on the Pont Neuf (until 1813) and its half-moon shops, and the bridges that do not touch the island (Pont des Arts, Pont Marie, Pont de Sully).

#### Performance

The detailed island has 3,463 buildings across all years (167,000 wall and roof triangles, against 95,000 for the old 600 m area). To keep it usable on phones:

- Identical vertices are merged behind an index, normals are stored as bytes and years as 16-bit integers (`web/src/meshpack.ts`): GPU buffers come to about 20 MB, less than the old area's 23 MB.
- Tree crowns have three levels of detail by distance (180, 80 and 20 faces, within 160 m, 450 m and beyond), refilled when the camera moves 30 m: about 318,000 triangles are drawn in a view over the island (308,000 before, with less than half the trees).

On Windows, Chrome compiles every shader with Direct3D's FXC compiler before the first 3D frame. `python -I tools/fxc/check.py` (on a Windows PC, see [tools/fxc/README.md](tools/fxc/README.md)) compiles all 19 fragment shaders the app draws the same way, on a 1 MB stack, and fails when one takes more than 5 seconds. On 2026-11-21 (AMD Ryzen 7 5700X, d3dcompiler_47 10.0.26100.9711) they took 8.6 s in all, with no stack overflow:

| Shader | HLSL kB | Compile s | Instruction slots |
| --- | ---: | ---: | ---: |
| walls-landmarks | 60 | 2.52 | 4,679 |
| facades | 55 | 2.20 | 2,748 |
| details | 38 | 1.27 | 1,846 |
| walls-bridges | 41 | 1.12 | 2,473 |
| walls-institutions | 28 | 0.50 | 1,551 |
| walls | 22 | 0.38 | 1,231 |
| decal | 11 | 0.15 | 757 |
| roofs | 18 | 0.15 | 703 |
| the 11 others | 1–6 each | 0.35 in all | 21–361 each |

The wall shader with every family in one program, as it was before it was split, takes 4.72 s and 6,236 slots; the app no longer draws it.

#### Streets through time

`python -m rpr streets --area cite` (needs shapely) writes `web/public/data/3d/streets-cite.json` (about 415 kB) for the whole Cité area, and `web/src/streets.ts` draws it. There are two street networks:

- **Before Haussmann (1780–1860): the Vasserot street space of about 1836.** A centreline is traced through every street (the medial axis of the street space, from a Voronoi diagram of its edges). Streets 2.4–14 m wide have a central gutter (ruisseau) and no pavements. Streets at least 10 m wide get 1.6 m pavements with granite kerbs from 1845: Prefect Chabrol required kerbed pavements on new streets from 1823, and the law of 7 June 1845 and the Paris rules of 1846 made them general; the 10 m rule is an approximation. The same streets are used before 1810.
- **From 1860: today's streets.** Pavements and pedestrian crossings from the City of Paris road plan (plan de voirie), main roads from IGN BD TOPO. Streets that survived the clearances (around rue Chanoinesse) switch to today's pavements in 1860 too. Pavements over the river wait for the present bridge (Petit-Pont 1853, Pont Saint-Michel 1857, Pont au Double 1883…).

Pavements are real geometry: a 15 cm step with granite kerbs and a gutter along them. The roadway is drawn by the ground shader by year: sandstone setts until 1970 (in 1907 about 6 of Paris's 10 million m² of roadway were still sandstone; granite setts mix in from 1900); main roads in macadam from 1860 and asphalt from 1900 (asphalt was first laid in rue Bergère in 1854); asphalt everywhere from 1970, as the setts were tarred over after 1968. These years are approximations.

Street furniture, with the year each kind appears:

| Item | Years | Where | Dates |
| --- | --- | --- | --- |
| Oil réverbères on a rope across the street, or on a post on squares and quays | until 1850 | every 45 m along the 1836 centrelines | Réverbères from 1766–1769. Gas replaced oil from 1839, oil was left on secondary streets in the early 1850s, the gas companies merged in 1855: gas on the Cité from 1850 is an approximation |
| Gas lanterns on wall brackets and cast-iron candelabra | 1850–1960 | the same places until 1860, then today's lamp positions | The last gas lamps of Paris went out in 1962 |
| Today's lamps (Paris lanterns, functional poles, wall lamps) | from 1960 | today's positions (éclairage public) | Functional poles from 1960 is an approximation |
| Street names engraved on stone, then blue enamel plaques | from 1729; enamel from 1847 | block corners, on both facades, only while the wall stands | Ordered in 1728; enamel plaques under Rambuteau from 1847 |
| Stone kerb stones (bornes) | until 1860 | corners of the 1836 blocks | |
| Rambuteau columns, then Morris columns | from 1839; Morris from 1868 | wide pavements, about 180 m apart | Authorised 1839 (478 by 1841); Morris from 1868 |
| Vespasiennes | 1868–1980 | wide pavements, about 300 m apart | Replaced by automatic toilets from 1980 (approximation) |
| Newspaper kiosks | from 1860 | today's kiosks | Kiosks from 1857 |
| Wallace fountains | from 1872 | today's fountains | First installed in 1872; the dataset has no installation dates |
| Benches | from 1860 | every 35 m on pavements at least 4.5 m deep | Approximation |
| Cast-iron tree grates | with each street tree | under the trees of the greenery step | |
| Pedestrian crossings: studs, then white bars | from 1930; bars from 1963 | today's crossings | 78 studded crossings in Paris in 1928, over 12,000 in 1934; white bars after the instruction of 22 October 1963 |
| Dashed centre lines | from 1963 | two-way main roads | Approximation |
| Bollards | from 1980 | today's bollards (plan de voirie) | Approximation |

Nothing stands inside a building standing that year: the app trims every life against the model's buildings, and plaques and wall lamps are moved onto the nearest facade of their years and show only while that wall stands. Positions placed by rule (lanterns, kerb stones, plaques, columns, benches) show the character of each period, not surveyed positions. Each model changes with the year on the GPU (oil lantern to gas, stone plaque to enamel, Rambuteau column to Morris), and furniture of the other network is skipped as a whole mesh, so about seven furniture draw calls are made in any year.

#### Vehicles and boats

`python -m rpr vehicles --area cite` places the vehicles and boats of each period, and `web/src/vehicles.ts` draws them (models in `vehiclemodels.ts`, shaders in `vehicleshaders.ts`). No particular cart or boat is documented: the types, their years and how many stand in the street come from the archive photographs and transport history, the places from the streets and quays of the period.

**What the photographs show.** About 70 photographs of the app's collection were looked at in full size (Paris Musées, ids below; years as catalogued), from Marville's 1858 street furniture series to Atget's views of the 1920s:

| Type | Photographs | What they show |
| --- | --- | --- |
| Handcart (voiture à bras) | 320001003, 320001893, 320002447 (Marville, 1865–68); 320043535 (Atget, 1898); 320042066 (Atget, 1923) | Parked in the narrow streets of the Cité and on the quai aux Fleurs; in 1923 a "Location de voitures à bras" sign at the corner of the rue des Chantres |
| Two-wheeled cart, tip-cart | 320002779 (Marville, 1858); 320043327, 320042234, 320042041 (Atget, undated); 320021697, 320021701 (Atget, 1913); 320176695 (Atget, 1914) | Tip-carts with their horses at the place du Châtelet, a coal cart by Notre-Dame on the quai de la Tournelle, unhitched carts resting on their shafts at the ports |
| Covered cart (charrette bâchée) | 320002447, 320002449 (Marville, 1865–68) | Parked at the kerb, rue Constantine and rue de la Cité |
| Horse cab (fiacre) | 320043314, 320043317 (Atget, about 1910); 320180275 (Atget, 1885–1925) | Coupé and victoria of the Compagnie générale des voitures with taximeters; a cab waiting by the bouquinistes, quai Malaquais |
| Horse omnibus | 320003760, 320004595 (Marville, 1858–78); 320039297 (Atget, 1898) | Compagnie générale des omnibus offices; a Madeleine–Bastille omnibus with its upper deck; in 1898 a three-horse omnibus with the curved stair to the impériale |
| Motor car, bus | 320176584 (Atget, 1885–1925); Albert-Kahn A 73 555 (1917), A 24 347–348 (1920), titles only | A car parked on the quai d'Orléans; a Renault parked on a quay; a bus station of the Compagnie générale des omnibus |
| Barge (péniche) | 320166588, 320042520, 320389039, 320175693, 320040645 (Atget, 1903); 320043217, 320042041 (Atget, undated) | Wooden barges, often with a mast, moored at the ports of the quai des Orfèvres, quai des Grands-Augustins and quai des Célestins, and opposite Notre-Dame |
| Wash-boat, floating baths | 320164787, 320041900 (Atget, before 1906); 320020894 (1910); 320040245, 320040650 (undated); Albert-Kahn A 7 506 (1914), A 39 019–020 (1923), titles only | A long boat-house moored at the quai des Orfèvres by the pont Saint-Michel; the bains de la Samaritaine and bains Vigier; wash-boats by the pont Marie and the quai de Bourbon into the 1920s |
| River steamer, rowing boat | 320020887 (Atget, 1911); 320021701 (1913); 320166588, 320040245 | A small steamer moored by the quai de l'Horloge, another under way; skiffs alongside barges and baths |
| Empty streets | 320002333, 320002450, 320002473, 320002478, 320002496 (Marville, 1865–68); 320178842, 320044265 (Atget, 1922–23) | Few vehicles in the Cité's streets. Marville's long exposures lose whatever moved, and Atget worked early in the morning, so the photographs undercount traffic |

Seen but not drawn: horse trams (320043333) and heavy stone drays (fardiers, 320043133, 320043322) on other quays.

**Years.** Each type is shown in the years history gives it, rounded conservatively where the end was gradual:

| Type | Years | Why |
| --- | --- | --- |
| Handcart, cart, covered cart | 1780–1940, –1935, –1930 | Throughout the photographs; ends reasoned (motor vans took over in the 1920s–30s) |
| Fiacre | 1780–1930 | Horse cabs dwindled through the 1920s |
| Horse omnibus | 1828–1913, upper deck from 1853 | Paris omnibuses from 1828 (Entreprise générale des omnibus), the Compagnie générale des omnibus from 1855, the last horse omnibus on 11 January 1913 |
| Motor taxi | 1905–1932 | Motor cabs with taximeters from 1905 (the Renault AG kind) |
| Early motor bus | 1906–1937 | First motor bus line of the CGO in 1906; Schneider buses into the 1930s |
| Early car, van | 1900–1936, 1910–1955 | Rare before 1900 |
| Mid-century car, van, platform bus | 1934–1980, 1950–1990, 1934–1971 | The last rear-platform buses ran in 1971 |
| Modern car, van, bus | from 1972, 1985, 1971 | |
| Barge, rowing boat | always | A houseboat cabin replaces the cargo from 1950; the mast goes in 1930 |
| Wash-boat, floating baths | 1780–1936, 1780–1930 | Still at the quai de Bourbon in 1923 (Albert-Kahn); the last Paris wash-boats went in the 1930s, the end is approximate |
| Steam river bus (bateau-mouche) | 1867–1934 | Introduced for the 1867 Exposition universelle; the river bus service ended in 1934 (approximate) |
| Sightseeing boat | from 1950 | Bateaux-mouches again from 1949 |

**Where they stand.**

- **1780–1859:** along the edges of the Vasserot street space (1810–1836, ALPAGE), where the street is at least 4.5 m wide; before 1810 this is an approximation. Few: one kerb place in twenty in the narrow streets, one in ten on the quays and squares.
- **From 1860:** along the kerbs of the IGN BD TOPO road centrelines, offset by half the carriageway width: both kerbs from 6 m, one kerb from 3.5 m (4.5 m from 2000, when the Cité's lanes are kept for residents). Kerbs fill from 7–14 % (1860s) to 55–70 % (1950s–60s), then 30–40 % today.
- **Junctions and bridges:** a few vehicles stand in the carriageway near junctions and on bridges, never where traffic runs. Bridges carry vehicles only from the year they did: the pont d'Arcole from 1855 (a footbridge before), the pont au Double from 1883, the pont de l'Archevêché from 1828; none on the pont Saint-Louis.
- **Moving traffic** follows through-routes (road segments joined at the straightest continuation), one line down the middle of streets under 10 m, two lanes keeping right on wider ones, respecting today's one-way streets from 1935. Before 1860 only along today's centrelines that run inside the Vasserot street space.
- **Boats** moor along the banks of today's river, clear of the bridges and leaving a channel; moving boats keep 26 m from the banks before 1950 (so only in the grand bras: the petit bras was the wash-boats' arm), 14 m after.
- **Never inside a building:** each vehicle's years are cut to those when no building of the massing model stands on its footprint (old Hôtel-Dieu wards over the water included), and again in the app against the buildings of the detailed area; a last pass keeps parked vehicles out of moving lanes and off each other.

**Drawing.** Each type is a low-poly model of a few hundred triangles (horses included: about 100 each) and one instanced draw call; the year is checked in the vertex shader, per vehicle and per part (the omnibus's upper deck, a barge's mast). Horses' legs swing as they walk, spoked wheels are cut out in the fragment shader, unhitched carts tip onto their shafts, and a soft shadow lies under each street vehicle. Paint colours are reasoned (the photographs are black and white): dark lacquer for cabs, the blue and weathered wood of carts, green and cream buses.

**Cost on phones.** Only vehicles within a few years of the one shown and inside the detailed ground are uploaded: 1960, the busiest year, draws about 800 (some 200,000 triangles), 1840 about 200. The 50 to 80 moving in a given year are animated on the CPU, at most 30 times a second and fewer when frames are slow, and only while one of them is on screen in the 3D view; otherwise the map is left idle. Data: `web/public/data/3d/vehicles-cite.json` (340 kB, about 7,000 parked and 550 moving vehicles across all years).

#### Photos in 3D and walking the streets

In the 3D view the archive photographs stand as picture frames where they were taken, from the years around the one you pick. Buildings hide the frames behind them, the frames turn to face you, and photos sharing a spot become one frame with a count. Click a frame to open the photo.

**Walk the streets** puts the camera about 2 m above the ground. Use the arrow keys or W A S D (Shift to go faster) and drag to look around and up. Buildings standing in the chosen year block the way, so changing the year changes the streets you can walk; if a building appears where you stand, you step out to the nearest open ground. Looking above the horizon uses MapLibre's experimental pitch beyond 90° with an unclamped camera centre.

WebGL can only draw images served with CORS headers. Albert-Kahn images load from the museum's portal; Paris Musées images come from small same-origin thumbnails (`python -m rpr thumbs --area cite`, 1,068 images, 7.6 MB, CC0).

#### 3D photos (AI depth)

`python -m rpr depth --set notre-dame` (needs `pip install -e ".[depth]"`) runs **Depth Anything V2 Small** (Apache 2.0, ONNX export by onnx-community, on CPU) on the 89 photos of Notre-Dame within 350 m of the cathedral: 78 Albert-Kahn autochromes and 11 Paris Musées prints. Paris Musées scans show the whole mounted card, so each print is cut out of its mount first. Each photo gets an 8-bit depth map (white = near), stored in `web/public/data/3d/depth/`.

In the app these photos get a **View as a 3D photo** button: the photo becomes a relief that shifts with the pointer, like looking through a window. In the 3D streets their frames become reliefs too, and they are shown first where several photos share a spot. The mesh is torn at sharp depth edges so foreground and background stay apart.

The depth is relative and estimated from a single image. It gives parallax, not a measured model, and the app says so.

#### Footprints traced from Vasserot's plans

`python -m rpr trace --area cite` (needs `pip install -e ".[geo,vision]"`) traces real building footprints from Vasserot's ground-floor plans, one coloured sheet per building, published by the Archives nationales under the Licence Ouverte 2.0:

1. Each sheet is matched to its parcel through the ALPAGE 1836 address points (street, number, quarter). The plans' index tells homonyms apart with a qualifier the points lack ("Sainte-Anne-en-la-Cité", "Harlay-au-Palais"), which is dropped, and spellings are compared loosely (Deux-Ermites, Deux-Hermites). A sheet for two houses ("n°6 et 8") is fitted to both parcels together. The place Dauphine's address points carry no street name: a point takes the name of a street still called the same today (and named by 1836, per the City's record) when it lies within 2 m of that street's outline, from the City of Paris street outlines (ODbL). The index corrects the number of 85 Cité sheets in brackets ("n°22 [en fait : 20]"). The number written on the sheet is the cadastre's and the correction is a later numbering: of the 29 such sheets that fit a parcel, 25 fit the written number's, and 3 of the 4 that fit only the corrected number's land on a parcel another traced sheet already holds. So the written number is used and the correction dropped. The index also notes a house's other address ("et 3 rue des Deux-Ermites"): a sheet whose own street or number the cadastre lacks, as on the streets opened or renumbered after it was drawn (rue de Constantine, rue de la Cité), is tried at that address. Each footprint records how it was matched (`match`).
2. The drawing is segmented in Lab colour, relative to the sheet's own paper: the pink wash marks built rooms, white areas closed by boundary lines are courtyards. Sheets that colour only the walls are flagged `walls_only`. Some sheets have no wash at all: the walls are drawn in ink. When the pink found is missing, runs into the sheet's margin (a strip of the scanner's background) or is a small fragment inside the ink drawing (its box covers under 15% of the drawing's), the sheet is read from its thick ink walls, closed over door gaps, and the walled area is the building (`drawing: ink walls`, `walls_only`).
3. The drawing is registered onto the parcel polygon (scale from areas, rotation searched to 0.25°, scored by IoU). Fits below 0.72 are rejected. Because the scale comes from the areas, a reading that caught only part of a drawing can still fit: an ink reading is rejected when the fitted sheet's long side would cover more than 100 m (73 of the 77 sheets traced from their wash cover 37–92 m). Each footprint records that length (`sheet_m`). Every fit is also checked against the sheet's own scale: the sheets are drawn at 1:200 (8,400 of the 11,200 scale bars in the index are within a tenth of "15 cm / 30 m"; a sheet with another bar is held to its own), and the index gives each sheet's paper size, so the ground a fitted sheet covers gives the scale the fit implies (`scale`). A fit is kept when that scale is 0.7 to 1.5 times the sheet's: 87 of the 93 sheets traced before this check came out at 1:152 to 1:284 (median 1:209, since the scans keep a margin around the paper), the other six at 1:119, 1:328 and 1:440 to 1:949.

On the Cité: 255 sheets with a street number, 114 traced (median IoU 0.84; 22 of them from their ink walls, 25 with a corrected number, 2 through a second address), 95 rejected for a poor fit (15 of them at the wrong scale), 46 without an address match. 88 of the demolished buildings in the 3D model stand on a traced footprint (the others' parcels are covered by a surviving building). Of the 95 poor fits, 46 come from the sheets with a corrected number or a second address and are not sorted yet; 6 were traced before the scale check (among them rue du Haut-Moulin n°3, which sat 45° off its parcel). The 43 others, sorted by eye: 17 sheets and parcels genuinely disagree (the sheet draws part of the parcel, or the parcel was divided differently); 7 leave out a yard open on one side, so their outline is smaller than the parcel; 5 are washed only in part (other rooms in brown or grey); 14 are ink drawings whose walls are too faint, hatched or broken to read, or read only in part (see `cite1836-*` items in the backlog). The 46 without a match: 24 sheets on streets opened or renumbered after the cadastre was drawn (rue d'Arcole 11, rue de Constantine 9, rue de la Cité 4), whose index gives no second address, so their numbers still need a concordance with the old ones; 8 in the cour de la Sainte-Chapelle, whose address points all fall on the single parcel of the Palais; and 14 whose number has no point in the cadastre. Traced buildings are shown in terracotta, with a link to the original sheet. Output: `web/public/data/3d/vasserot-traced-cite.geojson`.

Next: a concordance of old and new house numbers for the streets renumbered after 1836, the Vasserot block atlas for full coverage, roof shapes, and facade textures from the archive photographs.

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
python -m rpr streetnames   # former street names + 1836 address points for captions (needs [geo])
python -m rpr places        # gardens, squares, bridges and city gates for captions (BD TOPO + City of Paris)
python -m rpr monuments     # churches, hôtels, palaces, fountains and cemeteries for captions (Mérimée + BD TOPO)
python -m rpr parismusees   # Paris Musées photos, needs PARISMUSEES_TOKEN (--offline: place the saved works again)
python -m rpr headings      # facade bearings for photos placed at a house number (then parismusees --offline, index)
python -m rpr index         # rebuild photos.geojson + manifest.json
pytest -q
```

Paris Musées records carry no coordinates, so `rpr/geocode.py` reads the caption ("Hôtel Lambert, 13 quai d'Anjou, 4ème arrondissement", "Passage de l'Opéra, vue prise de la rue Lepeletier") for its arrondissements, streets, house numbers, corner ("à l'angle de", "coin des rues de Seine et de l'Echaudé") and the street the view was taken from. A street name ends where the caption moves on to a description, a date or another street ("Rue de Bretonvilliers avec l'hôtel de Bretonvilliers au fond", "Rue Berton mars 1901", "Impasse de la Baudroirie Rue de Venise"); "Fb", "Gds" and "Pont-Neuf" are read as "rue du Faubourg", "Grands" and "Pont Neuf". Each name is looked up in every arrondissement the caption gives, most precise answer first:

1. today's street in the national address base (IGN Géoplateforme geocoder), at the house number when the caption gives one; the caption's own name is taken down to a geocoder score of 0.5 ("Place St Sulpice", "rue Grenelle"), since only the spelling differs;
2. the street as it was in 1836, from the 29,164 ALPAGE address points of the Vasserot cadastre, for streets since demolished (rue de la Calandre, rue de la Licorne), at the numbered house when there is one;
3. a former name from the City of Paris *dénominations caduques* (rue de la Barillerie → boulevard du Palais), placed on today's street;
4. a garden, square, bridge, market or gate of that name (jardin du Luxembourg, square René-Viviani, pont au Change, marché Saint-Germain), at the centre of its outline, from a gazetteer of 1,758 places built from IGN BD TOPO and the City of Paris street outlines (`python -m rpr places`, `pipeline/cache/paris-places.json`); a gate of the Thiers wall ("porte d'Italie") on the place or avenue named after it, which runs out from where it stood. Names match whole, particles aside ("square Vert-Galant"), never in part;
5. today's street of the same kind (rue, place, boulevard…) spelt a letter or two apart ("rue Quimcampoix" is the rue Quincampoix, "rue Guirsade" the rue Guisarde, "boulevard Edgard-Quinet" the boulevard Edgar-Quinet), when it is the only street that near in the caption's arrondissement and the address base finds it there. Letters are compared without accents, particles, spaces or doubled letters: names of up to 7 letters may differ by one, longer ones by two; without an arrondissement, by one. Flagged `respelt` and its confidence multiplied by 0.9, and the photo card gives the caption's spelling. Never for a name known to be historical, nor for a caption that ends on another town ("Rue des Cuvettes, Beauvais"). Over the full works dump this places 30 more photos (5,693 → 5,723 of 6,725) and moves 18 to their house number or street from a landmark or a cross street; checked by hand, 47 of the 48 are the street the caption means and one is likely ("rue des Prévôts", the rue du Prévôt);
6. a close spelling in the address base (score 0.8 or more), but never for a name known to be historical: those stay on their own street or unplaced;
7. when none of these is in the caption's arrondissements: today's street or place of exactly that name (score 0.9 or more) in a neighbouring arrondissement ("5 rue du Mail, 1er arrondissement": the rue du Mail is in the 2nd), flagged with `caption_arrondissement` and its confidence multiplied by 0.6. Not when a street of that name is recorded in the caption's own arrondissement and gone since (the rue Larrey of the 6th): that is a different street.
8. when no street of the caption can be found, or it names none: the building it names ("Nef de l'église Saint-Julien-le-Pauvre", "Hôtel Lambert", "Palais du Louvre / cour Carrée", "Fontaine Médicis"), from a gazetteer of 5,330 landmarks: 860 protected buildings of the Mérimée list that have a proper name (of 1,894 in Paris), under every name their title gives ("Hôtel de Gournay ou de Mortemart, dit aussi d'Aguesseau"), and 4,470 named churches, schools, theatres, museums, ministries, hospitals and cemeteries of IGN BD TOPO (`python -m rpr monuments`, `pipeline/cache/paris-monuments.json`). A Mérimée point and a BD TOPO outline of one name within 300 m are one building, placed between them. The name must mean one building in the caption's arrondissement (several Saint-Pierre churches, several hôtels of one family) and that building must stand in the photo's year; one the caption calls "ancien" must be 50 years older than the photo (Marville's "ancien Hôtel-Dieu" is not today's). Without an arrondissement, the name must mean one building in all Paris, and a hôtel is never placed (a family often had several, some demolished and missing from the gazetteer), nor a name the caption carries on ("Hôtel-Dieu de Montlhéry"), nor a caption that ends on another town ("église Saint-Laurent, Rouen"). A name right after a kind of way or "vers" is a street's or the view's ("rue de l'Abbaye", "vue vers le Panthéon"), and one the caption qualifies is another building ("Petit Hôtel de Villars", "Hôtel de Montmorency [petit]"). Plain descriptions ("Fontaine publique", "Boulangerie"), street furniture found everywhere (Wallace fountains, Morris columns), statues and names too short to be told apart ("Saint-Marc") are left out; a site wider than 1 km (the Bois de Boulogne) is not placed. Over the full works dump this places 579 more photos (5,114 → 5,693 of 6,725): 554 of the 1,295 captions that named no street, and 25 whose street could not be found. In a hand-checked sample of 86, one per building, 82 stand within about 100 m of the building in OpenStreetMap or at the Mérimée record the caption means, and 2 are a different building of the same name (the duc du Maine's hôtel is not the duchesse's Hôtel Biron).

Two streets of the caption ("Rue X, vue prise de la rue Y", "à l'angle de") place the photo at their corner: where their 1836 address points come within 30 m, else where today's street outlines meet. A caption that names only a quarter ("île de la Cité") lands at its centre. Nothing is placed on a street that cannot be found. `confidence` follows precision, and `extra.precision` / `extra.method` say which rule placed the photo; the photo card states it ("At 13 Quai d'Anjou, the address in the caption"):

| Match | Confidence |
| --- | --- |
| House number found today | 0.6 |
| House number of a demolished street, in 1836 | 0.5 |
| Corner of two streets | 0.5 |
| 1836 house number on a street that lost it since | 0.4 |
| Street the view was taken from / street shown | 0.35 / 0.25 (× geocoder score) |
| Today's street for a former name (view / shown) | 0.3 / 0.2 |
| Building named in the caption, by how far it reaches from its centre: up to 150 m / 400 m / further (not past 1 km); a park or cemetery known only by a point: 0.1 | 0.3 / 0.2 / 0.1 |
| Garden, square, bridge or gate, by how far it reaches from its centre: up to 150 m / 400 m / further | 0.2 / 0.15 / 0.1 |
| Quarter only | 0.1 |

A place ranks below the streets of the same caption, so "Port du Louvre, vers le Pont Neuf" stays on the port.

A name that could mean several places (a former name used in two arrondissements, a homonym still in use elsewhere in the photo's year) is placed on the likeliest one, flagged `ambiguous` and its confidence multiplied by 0.6; part of a renamed street, or a demolished street more than 300 m long, by 0.8; a street the caption misspells, by 0.9. Lookups are cached in `pipeline/cache/geocode.json`; `python -m rpr streetnames` builds the historical tables in `pipeline/cache/` (`former-street-names.json`, `vasserot-1836.json`, `street-junctions.json`), `python -m rpr places` the gazetteer of places and `python -m rpr monuments` that of landmarks. The harvest saves the raw works to `pipeline/cache/parismusees-works.json.gz`, so `python -m rpr parismusees --offline` places them again without a token when the matching improves.

A photo placed at a house number also gets a heading, the compass bearing the camera faced: towards the building, square to its facade, from the street in front of it (method `facade`, heading confidence 0.5). The facade is the edge of today's street outline nearest the address point; address points sit about a metre outside that edge. No heading is given when the caption says the view was taken from elsewhere or shows a courtyard, a park, a staircase or an interior, or when the address is an 1836 one. `python -m rpr headings` saves the bearings by address point in `pipeline/cache/facade-bearings.json`, so `parismusees --offline` needs no download. 1,699 of the 10,002 photos have a heading. In a hand check of 20, all looked at the right side of the street; many photographers stood at an angle to the facade, so a heading can be up to about 60° off. The photo card says which way the camera faced, the then-and-now viewer looks that way, and the 3D frames stand along the heading, turning at most 60° towards the walker.

Every photo source is normalised into one schema (`pipeline/rpr/photo.py`): position, date range, image links, licence, credit, and how the camera position was obtained (`recorded`, `geocoded`, `matched`, `manual`, `estimated`) with a confidence score. Records outside Paris, with impossible dates or without an image are rejected and counted in `manifest.json`.

**What an Albert-Kahn position is.** The museum's dataset says each point is "the operator's position when the picture was taken". A hand check of 20 photos and of four shared points shows when that holds. A point of its own, or shared only by plates of one view (same caption, same date), is where the operator stood, to about 20 m: 2,213 photos, confidence 0.8. A point shared by photos with different captions or dates is the place they show or were taken in, not a tripod position: one point inside Notre-Dame carries 44 photos, among them views from the square, from across the Seine and of the Hôtel de Ville. These 2,089 photos are flagged `position_of: "place"` with the number of photos and dates on the point, at confidence 0.5 (435 photos, one visit) or 0.3 (1,654, several visits), and the photo card says so. No heading should be worked out from such a point.

### Harvest from GitHub Actions

The Opendatasoft portals that publish the Albert-Kahn data reset connections from some cloud sandboxes. Run **Actions › Harvest** with `source: kahn` instead. It commits the result to the branch it ran on. Tick `inspect` first to print the live field names.

For Paris Musées, create a free token at <https://apicollections.parismusees.paris.fr/> and add it as the repository secret `PARISMUSEES_TOKEN`.

## Deploy

`.github/workflows/pages.yml` publishes `web/dist` to GitHub Pages on every push to `main`. Enable it once under Settings › Pages › Source: GitHub Actions.

## Roadmap

1. **Phase 1, time-slider map** (this release): basemap timeline, cadastre, Panoramax "today" view, photo pipeline.
2. **Phase 2, then-and-now viewer** (this release): archive photo over the nearest Panoramax panorama, with alignment saved in the URL.
3. **Phase 3, pose refinement** (started): Marville and Atget captions are now placed at their house number, corner, former or demolished street, or the garden, square, bridge, city gate or building they name, using the City of Paris former street names and street outlines, the 1836 address points, IGN BD TOPO and the Mérimée list (see Paris Musées above). Still to do: the 741 captions that name no street and no building of the gazetteers (demolished buildings, interiors, objects); the 1888 street network; more headings (photos at a house number face their building; Kahn records and street views still have no direction, and only the Kahn points that are a camera position can get one); refine poses by matching against Panoramax imagery; let people submit the alignments they make in the viewer.
4. **Phase 4, 3D**: the Île de la Cité as a massing model, with footprints traced from Vasserot's plans, photos in the streets, an eye-level walk, and the whole island in detail with its bridges through time, the Hôtel-Dieu and the archbishop's palace (see above). Next: landmarks through time, streets and street furniture, period vehicles and richer facades, then more quarters.
5. **Phase 5, Paris around 1920 from its photographs** (planned): 6,331 of the 7,305 dated photographs were taken between 1900 and 1929, 1,270 of them around the Île de la Cité, and most buildings of those years still stand. The plan, one street of the Cité first:
   - give each photo of the era a full camera pose (position, bearing, pitch, field of view), by hand against the 3D model or by matching Panoramax pictures;
   - lay each posed photo on the walls it shows, as their facade for 1900–1929;
   - generate the walls no photo shows from the photos of the same street, in the pipeline, recording the photos and the model used;
   - say on each building's card whether a wall is a photo, generated from photos, or drawn by rule.

   The work is in `agents/backlog/era1920-*.md`.

## Licences

Code: MIT. Data keeps its source licence; see [DATA_SOURCES.md](DATA_SOURCES.md). The Vasserot data is ODbL, so derived databases that include it are shared under the ODbL.
