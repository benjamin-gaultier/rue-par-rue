import { describe, expect, it } from 'vitest'
import { bearing, distanceMeters, parsePictures } from '../src/panoramax'

describe('geometry helpers', () => {
  it('measures short distances in metres', () => {
    // Pont Neuf to Pont des Arts is roughly 400 m.
    const d = distanceMeters([2.3413, 48.8572], [2.3375, 48.8583])
    expect(d).toBeGreaterThan(250)
    expect(d).toBeLessThan(400)
  })
  it('computes compass bearings', () => {
    expect(bearing([2.35, 48.85], [2.35, 48.86])).toBeCloseTo(0, 0)
    expect(bearing([2.35, 48.85], [2.36, 48.85])).toBeCloseTo(90, 0)
  })
})

it('parses a Panoramax STAC search response', () => {
  // Shape copied from a live /api/search response (values shortened).
  const json = {
    features: [
      {
        id: 'old',
        geometry: { coordinates: [2.3501, 48.8532] as [number, number] },
        properties: { datetime: '2016-05-26T10:00:00Z', 'view:azimuth': 135, license: 'CC-BY-SA-4.0', 'pers:interior_orientation': { field_of_view: 360 } },
        assets: { thumb: { href: 'https://x/old/thumb.jpg' }, sd: { href: 'https://x/old/sd.jpg' } }
      },
      {
        id: 'new',
        geometry: { coordinates: [2.3502, 48.8529] as [number, number] },
        properties: { datetime: '2025-10-09T09:30:59Z', 'view:azimuth': 222, license: 'etalab-2.0', 'pers:interior_orientation': { field_of_view: 76 } },
        assets: { thumb: { href: 'https://x/new/thumb.jpg' }, sd: { href: 'https://x/new/sd.jpg' } }
      }
    ]
  }
  const pics = parsePictures(json, [2.3499, 48.853])
  expect(pics.map((p) => p.id)).toEqual(['new', 'old'])
  expect(pics[1].is360).toBe(true)
  expect(pics[0].distance).toBeLessThan(40)
  expect(pics[0].viewerUrl).toContain('pic=new')
})
