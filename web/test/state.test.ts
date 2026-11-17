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

  it('keeps a then-and-now alignment only with a selected photo', () => {
    const h = formatHash({ year: 1918, zoom: 17, lat: 48.853, lon: 2.35, photo: 'kahn:A 13 998', align: 'abcdef12-34,105.0,8.0,55' })
    expect(h).toContain('&a=abcdef12-34,105.0,8.0,55')
    expect(parseHash(h).align).toBe('abcdef12-34,105.0,8.0,55')
    expect(parseHash('#y=1918&a=abcdef12-34,1,2,55').align).toBeUndefined()
  })

  it('clamps years and ignores junk', () => {
    expect(parseHash('#y=1500').year).toBe(1780)
    expect(parseHash('#y=3000').year).toBe(2026)
    expect(parseHash('#y=abc&m=1/2').year).toBe(DEFAULT_STATE.year)
    expect(parseHash('#m=14/95/2').lat).toBe(DEFAULT_STATE.lat)
  })
})

describe('3D view in the URL', () => {
  it('round-trips the 3D flag with bearing and pitch', () => {
    const h = formatHash({ year: 1836, zoom: 17.3, lat: 48.8536, lon: 2.3466, bearing: 100, pitch: 68, view3d: true })
    expect(h).toBe('#y=1836&m=17.30/48.85360/2.34660/100.0/68.0&d=3d')
    const s = parseHash(h)
    expect([s.view3d, s.bearing, s.pitch]).toEqual([true, 100, 68])
  })
  it('keeps old three-part views working', () => {
    const s = parseHash('#y=1900&m=14/48.85/2.35')
    expect(s.pitch).toBeUndefined()
    expect(s.view3d).toBeUndefined()
  })
})
