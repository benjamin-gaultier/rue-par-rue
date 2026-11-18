/**
 * 3D prototype: the Île de la Cité as a massing model that follows the year.
 *
 * Built by `python -m rpr model3d --area cite`. Kinds of building:
 *   standing      built before 1851 and still standing (APUR footprint and height)
 *   reconstructed standing in 1836, demolished since (Vasserot parcel, estimated height)
 *   later         built after 1850, shown from its APUR construction period
 *   undated       no construction date in APUR, shown from 1851
 */

import { LngLat, type FilterSpecification, type Map as MapLibreMap } from 'maplibre-gl'

export const MODEL_URL = 'data/3d/cite-1836.geojson'

/** From above the Pont Saint-Michel, 160 m up, looking north-east at Notre-Dame. */
export const CITE_CAMERA = { from: [2.3455, 48.8522] as [number, number], altitude: 160, to: [2.3488, 48.8535] as [number, number] }
/** The same view as plain camera options (bearing 59°, pitch 60°). */
export const CITE_VIEW = { center: [2.3488, 48.8535] as [number, number], zoom: 17.3, pitch: 60, bearing: 59 }
/** The model's box (AREAS["cite"]["bbox"] in the pipeline): the whole island, its bridges and the facing quays. */
export const CITE_BOUNDS: [number, number, number, number] = [2.3385, 48.8505, 2.3565, 48.859]

export const MODEL_COLORS = {
  standing: '#ece2cc',
  traced: '#b06a32',
  reconstructed: '#d1a96b',
  later: '#c9cdd3',
  undated: '#c9cdd3'
} as const

export const MODEL_LABELS: Record<keyof typeof MODEL_COLORS, string> = {
  standing: 'Standing in 1836, still standing',
  traced: 'Demolished, footprint traced from Vasserot’s plan',
  reconstructed: 'Demolished, parcel outline (estimated)',
  later: 'Built later',
  undated: 'Undated'
}

/** Which buildings exist in a given year. */
export function modelFilter(year: number): FilterSpecification {
  return [
    'any',
    ['==', ['get', 'kind'], 'standing'],
    ['all', ['==', ['get', 'kind'], 'reconstructed'], ['<', year, ['get', 'until']]],
    ['all', ['in', ['get', 'kind'], ['literal', ['later', 'undated']]], ['<=', ['get', 'from'], year]]
  ]
}

/** Same rule as modelFilter, for tests and counts. */
export function existsIn(p: { kind: string; until?: number; from?: number }, year: number): boolean {
  if (p.kind === 'standing') return true
  if (p.kind === 'reconstructed') return year < (p.until ?? Infinity)
  return (p.from ?? Infinity) <= year
}

export interface ModelProps {
  kind: 'standing' | 'reconstructed' | 'later' | 'undated'
  height: number
  height_max?: number
  period: string
  built?: number
  source: string
  traced?: boolean
  address?: string
  name?: string
  plan_url?: string
  iou?: number
  /** Replaces the first popup line (for buildings not standing in 1836, such as houses on bridges). */
  note?: string
}

/** Plain-language lines for the building popup. */
export function describeBuilding(p: ModelProps): { title: string; lines: string[]; link?: { href: string; text: string } } {
  const title =
    p.address || p.name || (p.kind === 'standing' ? 'Building standing in 1836' : p.kind === 'reconstructed' ? 'Demolished building' : 'Later building')
  const lines: string[] = []
  if (p.note) lines.push(p.note)
  else if (p.kind === 'standing') lines.push(`Built ${p.period}${p.built ? ` (${p.built})` : ''}, still standing`)
  else if (p.kind === 'reconstructed') lines.push('Standing in 1836, demolished since')
  else lines.push(`Built ${p.period}`)
  lines.push(
    p.kind === 'reconstructed'
      ? `Height: about ${Math.round(p.height)} m (estimated)`
      : `Height: ${Math.round(p.height)} m median${p.height_max ? `, ${Math.round(p.height_max)} m at the highest` : ''} (measured)`
  )
  lines.push(p.source + (p.traced && p.iou ? ` · fit ${Math.round(p.iou * 100)}%` : ''))
  const link = p.plan_url ? { href: p.plan_url, text: 'Vasserot’s plan at the Archives nationales' } : undefined
  return { title, lines, link }
}

/** A pale Paris sky with a little haze toward the horizon. */
const SKY = {
  'sky-color': '#9fbbd8',
  'horizon-color': '#e6e1d6',
  'fog-color': '#e6e1d6',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': 0
}

export class Model3D {
  active = false
  private added = false
  private year = 1836
  /** Buildings drawn in detail by city3d.ts are left out of the plain blocks. */
  private hideFocus = false

  constructor(
    private map: MapLibreMap,
    private base: string,
    private beforeLayer: string
  ) {}

  enter(year: number, fly = true) {
    const map = this.map
    if (!this.added) {
      map.addSource('model', { type: 'geojson', data: this.base + MODEL_URL, attribution: 'Massing model: APUR (ODbL), Vasserot cadastre/ALPAGE (ODbL); river and bridges: IGN BD TOPO; trees: Ville de Paris (ODbL)' })
      map.addLayer(
        {
          id: 'model',
          type: 'fill-extrusion',
          source: 'model',
          paint: {
            // Reconstructed houses vary slightly with height so neighbours read apart.
            'fill-extrusion-color': [
              'match',
              ['get', 'kind'],
              'standing', MODEL_COLORS.standing,
              'reconstructed',
              [
                'case',
                ['boolean', ['get', 'traced'], false],
                MODEL_COLORS.traced,
                ['interpolate', ['linear'], ['get', 'height'], 12, '#c79c5a', 19, '#e0c08a']
              ],
              MODEL_COLORS.later
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.97,
            'fill-extrusion-vertical-gradient': true
          }
        },
        map.getLayer(this.beforeLayer) ? this.beforeLayer : undefined
      )
      this.added = true
    }
    map.setLayoutProperty('model', 'visibility', 'visible')
    map.setLight({ anchor: 'map', position: [1.5, 210, 35], intensity: 0.4, color: '#ffffff' })
    map.setSky(SKY)
    map.setMaxPitch(85)
    map.setMaxZoom(21)
    map.dragRotate.enable()
    map.touchZoomRotate.enableRotation()
    this.active = true
    this.setYear(year)
    if (fly) {
      const camera = map.calculateCameraOptionsFromTo(LngLat.convert(CITE_CAMERA.from), CITE_CAMERA.altitude, LngLat.convert(CITE_CAMERA.to), 0)
      map.flyTo({ ...camera, duration: 2400, essential: true })
    }
  }

  setYear(year: number) {
    this.year = year
    if (!this.added) return
    const filter = modelFilter(year)
    this.map.setFilter('model', this.hideFocus ? (['all', filter, ['!=', ['get', 'focus'], true]] as FilterSpecification) : filter)
  }

  setHideFocus(hide: boolean) {
    this.hideFocus = hide
    this.setYear(this.year)
  }

  exit() {
    const map = this.map
    this.active = false
    if (this.added) map.setLayoutProperty('model', 'visibility', 'none')
    // The sky stays set: it is only visible when the map is tilted.
    map.dragRotate.disable()
    map.touchZoomRotate.disableRotation()
    map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
    map.once('moveend', () => {
      if (this.active) return
      map.setMaxPitch(0)
      map.setMaxZoom(20)
    })
  }
}
