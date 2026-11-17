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
  heading?: number
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

export function extraOf(p: PhotoProps): Record<string, string> {
  if (!p.extra) return {}
  try {
    return JSON.parse(p.extra) as Record<string, string>
  } catch {
    return {}
  }
}

/** Explain how the photo was placed, naming the street for geocoded ones. */
export function positionLabel(p: PhotoProps): string {
  const street = extraOf(p).geocoded_street
  if (p.pose === 'geocoded' && street) {
    return `Approximate: on ${street.replace(/ \d{5} Paris$/, '')}, the street named in the caption`
  }
  return POSE_LABELS[p.pose] ?? p.pose
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
