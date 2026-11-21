/**
 * The areas drawn in 3D: one entry each, and nothing else to edit in the app.
 *
 * The pipeline has the same table (`AREAS` in pipeline/rpr/areas.py), which
 * builds the files named here. A test on each side checks that the two agree
 * (areas.test.ts here, tests/test_areas.py there).
 */

/** The data files of an area, relative to the site's base URL. */
export interface AreaFiles {
  /** Buildings through time (python -m rpr model3d). */
  model: string
  /** The Seine, bridges and landmark details (python -m rpr site). */
  site: string
  /** Gardens and trees (python -m rpr greenery). */
  greenery: string
  /** Streets and street furniture (python -m rpr streets). */
  streets: string
  /** Landmark styles, dates, spires and statues (python -m rpr landmarks). */
  landmarks: string
  /** Period vehicles and boats (python -m rpr vehicles). */
  vehicles: string
}

export interface Area {
  key: string
  name: string
  /** The model's box [west, south, east, north]: `bbox` of the same area in the pipeline. */
  bounds: [number, number, number, number]
  /** Where the camera flies to on entering 3D. */
  camera: { from: [number, number]; altitude: number; to: [number, number] }
  /** The same view as plain camera options. */
  view: { center: [number, number]; zoom: number; pitch: number; bearing: number }
  /** Where a walk starts when the map is not already on a spot inside the area, and the way it faces. */
  walk: { start: [number, number]; bearing: number }
  files: AreaFiles
}

const DIR = 'data/3d/'

export const AREAS = {
  cite: {
    key: 'cite',
    name: 'Île de la Cité',
    // The whole island, its bridges and the facing quays.
    bounds: [2.3385, 48.8505, 2.3565, 48.859],
    // From above the Pont Saint-Michel, 160 m up, looking north-east at Notre-Dame.
    camera: { from: [2.3455, 48.8522], altitude: 160, to: [2.3488, 48.8535] },
    view: { center: [2.3488, 48.8535], zoom: 17.3, pitch: 60, bearing: 59 },
    // On the parvis, facing Notre-Dame.
    walk: { start: [2.34838, 48.85336], bearing: 115 },
    files: {
      model: `${DIR}cite-1836.geojson`,
      site: `${DIR}site-cite.geojson`,
      greenery: `${DIR}greenery-cite.json`,
      streets: `${DIR}streets-cite.json`,
      landmarks: `${DIR}landmarks-cite.json`,
      vehicles: `${DIR}vehicles-cite.json`
    }
  }
} satisfies Record<string, Area>

/** The area the app loads. One for now: loading by distance is `quarters-load-by-area`. */
export const AREA: Area = AREAS.cite

export function areaCenter(area: Area): [number, number] {
  const [w, s, e, n] = area.bounds
  return [(w + e) / 2, (s + n) / 2]
}

export function inArea(area: Area, lng: number, lat: number): boolean {
  const [w, s, e, n] = area.bounds
  return lng > w && lng < e && lat > s && lat < n
}
