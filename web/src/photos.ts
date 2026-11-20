/**
 * Archive photographs: types, year filtering and the histogram above the slider.
 * The data is `data/photos.geojson`, written by the pipeline (see pipeline/rpr/photo.py).
 */

import type { FilterSpecification } from 'maplibre-gl'

export interface PhotoProps {
  id: string
  source: string
  source_id: string
  title: string
  year?: number
  year_end?: number
  date_text?: string
  creator?: string
  thumb?: string
  image?: string
  iiif?: string
  url?: string
  license: string
  credit?: string
  media: string
  pose: 'estimated' | 'geocoded' | 'recorded' | 'matched' | 'manual'
  /** Compass bearing the camera faced, degrees; how it was obtained is `heading_method`. */
  heading?: number
  heading_method?: 'recorded' | 'facade'
  heading_confidence?: number
  fov?: number
  confidence: number
  /** JSON string of source-specific details (see pipeline/rpr/photo.py). */
  extra?: string
}

export interface PhotoFeature {
  type: 'Feature'
  id: string
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: PhotoProps
}

export interface PhotoCollection {
  type: 'FeatureCollection'
  features: PhotoFeature[]
}

/** Photos within this many years of the selected year are shown. */
export const YEAR_WINDOW = 8

export const SOURCE_COLORS: Record<string, string> = {
  kahn: '#c2410c',
  parismusees: '#1d4c9c',
  gallica: '#7c3aed'
}
export const FALLBACK_COLOR = '#475569'

export const SOURCE_NAMES: Record<string, string> = {
  kahn: 'Albert-Kahn, Archives de la Planète',
  parismusees: 'Paris Musées (Carnavalet)',
  gallica: 'Gallica, BnF'
}

export const POSE_LABELS: Record<PhotoProps['pose'], string> = {
  recorded: 'Camera position recorded by the archive',
  matched: 'Camera position matched against modern imagery',
  manual: 'Camera position placed by a volunteer',
  geocoded: 'Approximate position from the caption',
  estimated: 'Rough position'
}

/** MapLibre filter: undated photos always show; dated ones within the window. */
export function yearFilter(year: number, window = YEAR_WINDOW, showAll = false): FilterSpecification {
  if (showAll) return ['all']
  const from = year - window
  const to = year + window
  return [
    'any',
    ['!', ['has', 'year']],
    [
      'all',
      ['<=', ['get', 'year'], to],
      ['>=', ['coalesce', ['get', 'year_end'], ['get', 'year']], from]
    ]
  ]
}

export function inWindow(p: PhotoProps, year: number, window = YEAR_WINDOW): boolean {
  if (p.year === undefined) return true
  const end = p.year_end ?? p.year
  return p.year <= year + window && end >= year - window
}

export interface Bin {
  start: number
  count: number
}

/** Count dated photos per `size`-year bin between min and max (inclusive). */
export function histogram(features: PhotoFeature[], min: number, max: number, size = 5): Bin[] {
  const bins: Bin[] = []
  for (let s = min - (min % size); s <= max; s += size) bins.push({ start: s, count: 0 })
  const first = bins[0]?.start ?? min
  for (const f of features) {
    const y = f.properties.year
    if (y === undefined || y < first || y > max) continue
    const i = Math.floor((y - first) / size)
    if (bins[i]) bins[i].count++
  }
  return bins
}

export function colorExpression(): unknown[] {
  const expr: unknown[] = ['match', ['get', 'source']]
  for (const [k, v] of Object.entries(SOURCE_COLORS)) expr.push(k, v)
  expr.push(FALLBACK_COLOR)
  return expr
}

export type Extra = Record<string, string | number | boolean | undefined>

export function extraOf(p: PhotoProps): Extra {
  if (!p.extra) return {}
  try {
    return JSON.parse(p.extra) as Extra
  } catch {
    return {}
  }
}

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

/**
 * Explain how the photo was placed. Geocoded captions name the address,
 * corner, street, place or quarter they were matched to (see pipeline/rpr/geocode.py).
 */
export function positionLabel(p: PhotoProps): string {
  const x = extraOf(p)
  if (p.pose !== 'geocoded' || typeof x.geocoded_street !== 'string') return POSE_LABELS[p.pose] ?? p.pose
  const place = x.geocoded_street.replace(/ \d{5} Paris$/, '')
  const elsewhere =
    typeof x.caption_arrondissement === 'number'
      ? `; the caption says the ${ordinal(x.caption_arrondissement)} arrondissement, but it lies in the next one`
      : ''
  const maybe = elsewhere + (x.ambiguous ? '; the caption could also mean another place' : '')
  switch (x.precision) {
    case 'number':
      return x.method === 'vasserot-1836'
        ? `At ${place}, the address in the caption, as numbered in 1836${maybe}`
        : `At ${place}, the address in the caption${maybe}`
    case 'corner':
      return `At the corner of ${place.replace(' / ', ' and ')}, named in the caption${maybe}`
    case 'quarter':
      return `Rough: somewhere in ${String(x.from_caption ?? place)}, named in the caption`
    case 'place':
      return x.method === 'gate-way'
        ? `Approximate: on ${place}, by the ${String(x.from_caption)} of the caption (a gate of the city wall)${maybe}`
        : `Approximate: at ${place}, named in the caption${maybe}`
    default:
      if (x.method === 'vasserot-1836') return `Approximate: on ${place}, a street since demolished (where it ran in 1836)${maybe}`
      if (x.method === 'former-name') return `Approximate: on ${place}, today's name for the ${String(x.from_caption)} of the caption${maybe}`
      return `Approximate: on ${place}, the street named in the caption${maybe}`
  }
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** 'north-east' for 40°. */
export function compassPoint(bearing: number): string {
  return COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

/** Which way the camera faced and how we know, or null when unknown. */
export function headingLabel(p: PhotoProps): string | null {
  if (p.heading === undefined) return null
  const where = `Facing ${compassPoint(p.heading)} (${Math.round(p.heading)}°)`
  if (p.heading_method === 'facade')
    return `${where}: towards the building at the address, from the street in front of it. Worked out from the street's outline; the photographer may have stood at an angle.`
  if (p.heading_method === 'recorded') return `${where}, as recorded by the archive`
  return where
}

export function dateLabel(p: PhotoProps): string {
  if (p.year && p.year_end && p.year_end !== p.year) return `${p.year}–${p.year_end}`
  if (p.year) return String(p.year)
  return p.date_text ?? 'Undated'
}

export async function loadPhotos(base: string): Promise<PhotoCollection> {
  try {
    const res = await fetch(`${base}data/photos.geojson`)
    if (!res.ok) return { type: 'FeatureCollection', features: [] }
    return (await res.json()) as PhotoCollection
  } catch {
    return { type: 'FeatureCollection', features: [] }
  }
}
