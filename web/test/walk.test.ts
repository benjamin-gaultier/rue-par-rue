import { describe, expect, it } from 'vitest'
import { blocked, insidePolygon, offset, slide, toObstacles } from '../src/walk'

const square = (x: number, y: number, d: number): [number, number][] => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]

describe('walking', () => {
  it('moves along compass headings', () => {
    const [lon, lat] = offset([2.35, 48.85], 0, 111)
    expect(lon).toBeCloseTo(2.35, 6)
    expect(lat).toBeGreaterThan(48.85)
    const [lon2] = offset([2.35, 48.85], 90, 10)
    expect(lon2).toBeGreaterThan(2.35)
  })
  it('tests points against polygons with courtyards', () => {
    const ring = square(0, 0, 10)
    const yard = square(4, 4, 2)
    expect(insidePolygon([1, 1], [ring])).toBe(true)
    expect(insidePolygon([5, 5], [ring, yard])).toBe(false)
    expect(insidePolygon([11, 5], [ring])).toBe(false)
  })
  it('is blocked only by buildings standing in the chosen year', () => {
    const obstacles = toObstacles({
      features: [
        { geometry: { type: 'Polygon', coordinates: [square(2.35, 48.85, 0.0001)] }, properties: { kind: 'reconstructed', height: 15, period: '', source: '', until: 1860 } as never },
        { geometry: { type: 'Polygon', coordinates: [square(2.36, 48.85, 0.0001)] }, properties: { kind: 'later', height: 20, period: '', source: '', from: 1877 } as never }
      ]
    })
    const inOld: [number, number] = [2.35005, 48.85005]
    const inNew: [number, number] = [2.36005, 48.85005]
    expect(blocked(inOld, 1836, obstacles)).toBe(true)
    expect(blocked(inOld, 1900, obstacles)).toBe(false) // demolished by then
    expect(blocked(inNew, 1836, obstacles)).toBe(false) // not built yet
    expect(blocked(inNew, 1900, obstacles)).toBe(true)
  })

  it('slides along a wall met at a slant, and stops at one met head on', () => {
    // A wall north of latitude 48.8501: walking north-east slides east along it.
    const wall = (p: [number, number]) => p[1] > 48.8501
    const start: [number, number] = [2.35, 48.85009]
    const p = slide(start, 45, 2, wall)!
    expect(p).not.toBeNull()
    expect(p[0]).toBeGreaterThan(start[0])
    expect(wall(p)).toBe(false)
    // Head on, the step is too short along the wall to get anywhere much.
    const q = slide(start, 0, 2, wall)
    if (q) expect(Math.abs(q[0] - start[0]) * 73300).toBeLessThan(2)
    // Boxed in: no step.
    expect(slide(start, 0, 2, () => true)).toBeNull()
  })
})
