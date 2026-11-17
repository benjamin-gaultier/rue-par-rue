/**
 * Shareable view state in the URL hash: #y=1836&m=15/48.85300/2.34990&p=kahn:A1
 */

import { YEAR_MAX, YEAR_MIN } from './timeline'

export interface ViewState {
  year: number
  zoom?: number
  lat?: number
  lon?: number
  bearing?: number
  pitch?: number
  /** 3D model of the Île de la Cité */
  view3d?: boolean
  photo?: string
  /** Then-and-now alignment, see alignment.ts */
  align?: string
}

export const DEFAULT_STATE: ViewState = { year: 1900, zoom: 14.2, lat: 48.8566, lon: 2.3475 }

export function clampYear(y: number): number {
  return Math.min(YEAR_MAX, Math.max(YEAR_MIN, Math.round(y)))
}

export function parseHash(hash: string): ViewState {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const state: ViewState = { ...DEFAULT_STATE }
  const y = Number(params.get('y'))
  if (params.has('y') && Number.isFinite(y)) state.year = clampYear(y)
  const m = params.get('m')?.split('/').map(Number)
  if (m && (m.length === 3 || m.length === 5) && m.every(Number.isFinite)) {
    const [zoom, lat, lon, bearing, pitch] = m
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) Object.assign(state, { zoom, lat, lon })
    if (m.length === 5) Object.assign(state, { bearing, pitch: Math.max(0, Math.min(80, pitch)) })
  }
  if (params.get('d') === '3d') state.view3d = true
  const p = params.get('p')
  if (p) state.photo = p
  const a = params.get('a')
  if (a && p) state.align = a
  return state
}

export function formatHash(s: ViewState): string {
  const params = new URLSearchParams()
  params.set('y', String(s.year))
  if (s.zoom !== undefined && s.lat !== undefined && s.lon !== undefined) {
    let m = `${s.zoom.toFixed(2)}/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`
    if (s.pitch || s.bearing) m += `/${(s.bearing ?? 0).toFixed(1)}/${(s.pitch ?? 0).toFixed(1)}`
    params.set('m', m)
  }
  if (s.view3d) params.set('d', '3d')
  if (s.photo) params.set('p', s.photo)
  if (s.photo && s.align) params.set('a', s.align)
  return '#' + params.toString().replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',')
}
