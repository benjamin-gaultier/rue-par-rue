import { describe, expect, it } from 'vitest'
import { reliefGeometry, sample, type DepthGrid } from '../src/depth'

const grid = (w: number, h: number, f: (x: number, y: number) => number): DepthGrid => {
  const values = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) values[y * w + x] = f(x, y)
  return { w, h, values }
}

describe('depth sampling', () => {
  it('interpolates between pixels', () => {
    const g = grid(2, 1, (x) => x) // 0 on the left, 1 on the right
    expect(sample(g, 0, 0)).toBe(0)
    expect(sample(g, 1, 0)).toBe(1)
    expect(sample(g, 0.5, 0)).toBeCloseTo(0.5)
  })
})

describe('relief geometry', () => {
  it('pushes far points back and keeps near points at the picture plane', () => {
    const g = grid(4, 4, (x) => (x < 2 ? 1 : 0)) // near on the left, far on the right
    const geo = reliefGeometry(g, { aspect: 1, strength: 0.5, segments: 4, tear: 2 })
    const pos = geo.getAttribute('position')
    // facing 'z': depth is -z
    expect(pos.getZ(0)).toBeCloseTo(0) // top-left, near
    expect(pos.getZ(4)).toBeCloseTo(-0.5) // top-right, far
  })
  it('tears the mesh across sharp depth edges', () => {
    const g = grid(8, 8, (x) => (x < 4 ? 1 : 0))
    const smooth = reliefGeometry(g, { aspect: 1, strength: 0.5, segments: 8, tear: 2 })
    const torn = reliefGeometry(g, { aspect: 1, strength: 0.5, segments: 8, tear: 0.12 })
    expect(torn.getIndex()!.count).toBeLessThan(smooth.getIndex()!.count)
  })
  it('lays map frames along -y with z up', () => {
    const g = grid(2, 2, () => 0)
    const geo = reliefGeometry(g, { aspect: 2, strength: 0.3, segments: 2, facing: '-y' })
    const pos = geo.getAttribute('position')
    expect(pos.getY(0)).toBeCloseTo(0.3) // far is +y, away from the viewer
    expect(pos.getZ(0)).toBeCloseTo(0.5) // top edge
    expect(pos.getX(0)).toBeCloseTo(-1) // left edge of a 2-wide frame
  })
})
