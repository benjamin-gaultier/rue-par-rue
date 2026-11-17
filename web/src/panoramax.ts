/**
 * Today's street-level imagery from Panoramax, the open alternative to Street View.
 *
 * `place_position` asks for pictures that look at a point, not pictures
 * taken near it, which is what a then-and-now comparison needs.
 * API docs: https://docs.panoramax.fr/
 */

export const PANORAMAX_API = 'https://api.panoramax.xyz/api'
export const PANORAMAX_TILES = `${PANORAMAX_API}/map/{z}/{x}/{y}.mvt`

export interface TodayPicture {
  id: string
  lon: number
  lat: number
  date: string
  azimuth?: number
  fov?: number
  is360: boolean
  thumb: string
  sd: string
  hd: string
  license: string
  producer?: string
  distance: number
  viewerUrl: string
}

interface StacFeature {
  id: string
  geometry: { coordinates: [number, number] }
  properties: Record<string, unknown>
  assets: Record<string, { href: string }>
  providers?: { name: string; roles?: string[] }[]
}

export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371008.8
  const toRad = Math.PI / 180
  const dLat = (b[1] - a[1]) * toRad
  const dLon = (b[0] - a[0]) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Compass bearing in degrees from a to b. */
export function bearing(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const y = Math.sin((b[0] - a[0]) * toRad) * Math.cos(b[1] * toRad)
  const x =
    Math.cos(a[1] * toRad) * Math.sin(b[1] * toRad) -
    Math.sin(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.cos((b[0] - a[0]) * toRad)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function viewerUrl(id: string, lon: number, lat: number): string {
  return `https://api.panoramax.xyz/#focus=pic&pic=${id}&map=19/${lat.toFixed(6)}/${lon.toFixed(6)}`
}

export function parsePictures(json: { features?: StacFeature[] }, origin: [number, number]): TodayPicture[] {
  const out: TodayPicture[] = []
  for (const f of json.features ?? []) {
    const p = f.properties
    const io = (p['pers:interior_orientation'] ?? {}) as { field_of_view?: number }
    const [lon, lat] = f.geometry.coordinates
    const thumb = f.assets.thumb?.href
    const sd = f.assets.sd?.href ?? thumb
    const hd = f.assets.hd?.href ?? sd
    if (!thumb || !sd || !hd) continue
    out.push({
      id: f.id,
      lon,
      lat,
      date: String(p.datetime ?? '').slice(0, 10),
      azimuth: typeof p['view:azimuth'] === 'number' ? (p['view:azimuth'] as number) : undefined,
      fov: io.field_of_view,
      is360: io.field_of_view === 360,
      thumb,
      sd,
      hd,
      license: String(p.license ?? 'see Panoramax'),
      producer: f.providers?.find((x) => x.roles?.includes('producer'))?.name,
      distance: distanceMeters(origin, [lon, lat]),
      viewerUrl: viewerUrl(f.id, lon, lat)
    })
  }
  // Newest first; among the same day, closest first.
  return out.sort((a, b) => (a.date === b.date ? a.distance - b.distance : a.date < b.date ? 1 : -1))
}

/** Pictures looking at `target` (the place the archive photo shows). */
export async function picturesOf(
  target: [number, number],
  { radius = 60, limit = 12, signal }: { radius?: number; limit?: number; signal?: AbortSignal } = {}
): Promise<TodayPicture[]> {
  const url = `${PANORAMAX_API}/search?place_position=${target[0]},${target[1]}&place_distance=0-${radius}&limit=${limit}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Panoramax answered ${res.status}`)
  return parsePictures(await res.json(), target)
}
