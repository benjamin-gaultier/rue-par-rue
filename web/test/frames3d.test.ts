import { describe, expect, it } from 'vitest'
import { frameHeight, groupPhotos, metersPerPixel, nearestGroups } from '../src/frames3d'
import type { PhotoFeature, PhotoProps } from '../src/photos'

const BOUNDS: [number, number, number, number] = [2.3395, 48.8505, 2.3565, 48.859]
let n = 0
const photo = (lon: number, lat: number, year?: number, source = 'kahn'): PhotoFeature => {
  const id = `${source}:${++n}`
  const properties: PhotoProps = { id, source, source_id: String(n), title: 't', license: 'x', media: 'photo', pose: 'recorded', confidence: 0.8, year }
  return { type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties }
}

describe('grouping photos into frames', () => {
  it('merges photos taken from the same spot and shows the closest in date', () => {
    const a = photo(2.3499, 48.853, 1910)
    const b = photo(2.34991, 48.85301, 1918)
    const c = photo(2.3460, 48.8540, 1915)
    const groups = groupPhotos([a, b, c], 1917, false, BOUNDS)
    expect(groups).toHaveLength(2)
    const shared = groups.find((g) => g.count === 2)!
    expect(shared.photo.id).toBe(b.id)
  })
  it('shows a preferred photo (one with a depth map) first at a shared spot', () => {
    const a = photo(2.3499, 48.853, 1914)
    const b = photo(2.34991, 48.85301, 1910) // further in date, but has a depth map
    const [g] = groupPhotos([a, b], 1914, false, BOUNDS, undefined, (f) => f.id === b.id)
    expect(g.photo.id).toBe(b.id)
  })
  it('respects the year window, bounds and the all-years switch', () => {
    const old = photo(2.3499, 48.853, 1860)
    const outside = photo(2.30, 48.86, 1914)
    expect(groupPhotos([old, outside], 1914, false, BOUNDS)).toHaveLength(0)
    expect(groupPhotos([old, outside], 1914, true, BOUNDS)).toHaveLength(1)
  })
  it('keeps the nearest groups to the view centre', () => {
    const groups = groupPhotos([photo(2.341, 48.856, 1914), photo(2.3495, 48.853, 1914), photo(2.355, 48.852, 1914)], 1914, false, BOUNDS)
    const near = nearestGroups(groups, [2.3497, 48.8531], 1)
    expect(near[0].lon).toBeCloseTo(2.3495)
  })
})

describe('frame size', () => {
  it('follows the zoom between 5 m and 30 m', () => {
    expect(metersPerPixel(17, 48.85)).toBeCloseTo(0.393, 2)
    expect(frameHeight(15, 48.85)).toBe(30)
    expect(frameHeight(23, 48.85)).toBe(5)
    expect(frameHeight(18.5, 48.85)).toBeGreaterThan(5)
    expect(frameHeight(18.5, 48.85)).toBeLessThan(30)
  })
})
