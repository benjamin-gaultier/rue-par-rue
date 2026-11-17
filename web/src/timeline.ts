/**
 * The basemap timeline: which map or aerial photograph to show for a year.
 *
 * Each entry starts at `from`. For a selected year we show the latest entry
 * whose `from` is not after it, so the map is never "from the future".
 * Before the first survey we fall back to the earliest one and say so.
 */

export const YEAR_MIN = 1780
export const YEAR_MAX = 2026

export interface WmtsLayer {
  kind: 'wmts'
  layer: string
  format: 'image/png' | 'image/jpeg'
  matrixSet: string
  style?: string
  minzoom?: number
  maxzoom: number
}

export interface AllmapsLayer {
  kind: 'allmaps'
  url: string
}

export interface Basemap {
  id: string
  /** First year this basemap is used for. */
  from: number
  /** Year label shown to people (survey or flight dates). */
  dated: string
  title: string
  attribution: string
  source: WmtsLayer | AllmapsLayer
  /** Covers only the pre-1860 city; outside it the paper background shows. */
  partial?: boolean
  /** Show the year under its tick on the slider (others get a bare tick). */
  label?: boolean
}

const IGN = '© IGN – Géoplateforme'

const wmts = (layer: string, maxzoom: number, opts: Partial<WmtsLayer> = {}): WmtsLayer => ({
  kind: 'wmts',
  layer,
  format: 'image/jpeg',
  matrixSet: 'PM_6_18',
  maxzoom,
  ...opts
})

export const BASEMAPS: Basemap[] = [
  {
    id: 'verniquet',
    label: true,
    from: 1785,
    dated: '1785–1791',
    title: 'Verniquet, Plan de la ville de Paris',
    attribution:
      'Verniquet atlas: David Rumsey Map Collection · georeferencing: SoDUCo, doi:10.7910/DVN/ZKRJFA (CC0)',
    source: { kind: 'allmaps', url: 'data/verniquet.json' },
    partial: true
  },
  {
    id: 'etatmajor',
    label: true,
    from: 1820,
    dated: '1820–1866',
    title: "Carte de l'état-major",
    attribution: IGN,
    // The 1:10,000 "environs de Paris" sheets leave the city blank, so we use
    // the national 1:40,000 map, which draws Paris.
    source: wmts('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 15, { matrixSet: 'PM_6_15' })
  },
  {
    id: 'carte1906',
    label: true,
    from: 1906,
    dated: '1906',
    title: 'Carte topographique des environs de Paris',
    attribution: IGN,
    source: wmts('GEOGRAPHICALGRIDSYSTEMS.1900TYPEMAPS', 15, { matrixSet: 'PM_10_15', minzoom: 10 })
  },
  {
    id: 'ortho1949',
    label: true,
    from: 1949,
    dated: '1949',
    title: 'Aerial photograph of Paris',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.EDUGEO.PARIS1949', 18, { format: 'image/png' })
  },
  {
    id: 'ortho1965',
    label: true,
    from: 1965,
    dated: '1965',
    title: 'Aerial photograph of Paris',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.EDUGEO.PARIS1965', 16, { format: 'image/png', matrixSet: 'PM_6_16' })
  },
  {
    id: 'ortho2000',
    label: true,
    from: 2000,
    dated: '2000–2005',
    title: 'Aerial photographs',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.ORTHOPHOTOS2000-2005', 18)
  },
  {
    id: 'ortho2006',
    from: 2006,
    dated: '2006–2010',
    title: 'Aerial photographs',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.ORTHOPHOTOS2006-2010', 18)
  },
  {
    id: 'ortho2011',
    from: 2011,
    dated: '2011–2015',
    title: 'Aerial photographs',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.ORTHOPHOTOS2011-2015', 18)
  },
  {
    id: 'ortho2016',
    from: 2016,
    dated: '2016–2020',
    title: 'Aerial photographs',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.ORTHOPHOTOS2016-2020', 19, { matrixSet: 'PM_6_19' })
  },
  {
    id: 'ortho2021',
    from: 2021,
    dated: '2021–2023',
    title: 'Aerial photographs',
    attribution: IGN,
    source: wmts('ORTHOIMAGERY.ORTHOPHOTOS2021-2023', 19, { matrixSet: 'PM_6_19' })
  },
  {
    id: 'planign',
    label: true,
    from: 2025,
    dated: 'today',
    title: 'Plan IGN',
    attribution: IGN,
    source: wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 19, { format: 'image/png', matrixSet: 'PM_0_19' })
  }
]

export interface BasemapChoice {
  basemap: Basemap
  /** True when the year is earlier than any map we have. */
  nearestOnly: boolean
}

export function basemapForYear(year: number, basemaps: Basemap[] = BASEMAPS): BasemapChoice {
  const sorted = [...basemaps].sort((a, b) => a.from - b.from)
  let chosen = sorted[0]
  for (const b of sorted) {
    if (b.from <= year) chosen = b
  }
  return { basemap: chosen, nearestOnly: year < sorted[0].from }
}

export function wmtsTileUrl(s: WmtsLayer): string {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: s.layer,
    STYLE: s.style ?? 'normal',
    TILEMATRIXSET: s.matrixSet,
    FORMAT: s.format
  })
  // MapLibre substitutes {z}/{x}/{y}; keep the braces unescaped.
  return `https://data.geopf.fr/wmts?${params.toString()}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`
}

/**
 * The cadastre was surveyed 1810–1836. Before that it would be a map from the
 * future, so it stays hidden; until Haussmann it is the street plan; after,
 * a ghost that shows which streets disappeared.
 */
export function cadastreMode(year: number): 'hidden' | 'primary' | 'ghost' {
  if (year < 1810) return 'hidden'
  return year < 1860 ? 'primary' : 'ghost'
}
