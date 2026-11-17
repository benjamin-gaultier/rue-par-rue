/**
 * Shareable view state in the URL hash: #y=1836&m=15/48.85300/2.34990&p=kahn:A1
 */

import { YEAR_MAX, YEAR_MIN } from './timeline'

export interface ViewState {
  year: number
  zoom?: number
  lat?: number
  lon?: number
  photo?: string
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
  if (m && m.length === 3 && m.every(Number.isFinite)) {
    const [zoom, lat, lon] = m
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) Object.assign(state, { zoom, lat, lon })
  }
  const p = params.get('p')
  if (p) state.photo = p
  return state
}

export function formatHash(s: ViewState): string {
  const params = new URLSearchParams()
  params.set('y', String(s.year))
  if (s.zoom !== undefined && s.lat !== undefined && s.lon !== undefined) {
    params.set('m', `${s.zoom.toFixed(2)}/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}`)
  }
  if (s.photo) params.set('p', s.photo)
  return '#' + params.toString().replace(/%2F/g, '/').replace(/%3A/g, ':')
}
