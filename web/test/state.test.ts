import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, formatHash, parseHash } from '../src/state'

describe('URL hash state', () => {
  it('round-trips year, view and photo', () => {
    const s = { year: 1836, zoom: 15.5, lat: 48.853, lon: 2.3499, photo: 'kahn:A 4 512' }
    const parsed = parseHash(formatHash(s))
    expect(parsed.year).toBe(1836)
    expect(parsed.zoom).toBeCloseTo(15.5)
    expect(parsed.lat).toBeCloseTo(48.853, 5)
    expect(parsed.photo).toBe('kahn:A 4 512')
  })

  it('keeps the hash readable', () => {
    expect(formatHash({ year: 1900, zoom: 14, lat: 48.85, lon: 2.35, photo: 'kahn:A1' })).toBe(
      '#y=1900&m=14.00/48.85000/2.35000&p=kahn:A1'
    )
  })

  it('clamps years and ignores junk', () => {
    expect(parseHash('#y=1500').year).toBe(1780)
    expect(parseHash('#y=3000').year).toBe(2026)
    expect(parseHash('#y=abc&m=1/2').year).toBe(DEFAULT_STATE.year)
    expect(parseHash('#m=14/95/2').lat).toBe(DEFAULT_STATE.lat)
  })
})
