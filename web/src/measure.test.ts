import { describe, expect, it } from 'vitest'
import { frameStats, sceneBuffers } from './measure'

describe('frameStats', () => {
  it('gives the median, the 95th percentile and the worst frame', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100 ms
    expect(frameStats(times)).toEqual({ frames: 100, medianMs: 50, p95Ms: 95, maxMs: 100 })
  })
  it('does not depend on the order of the frames', () => {
    expect(frameStats([30, 10, 20])).toEqual(frameStats([10, 20, 30]))
    expect(frameStats([30, 10, 20]).medianMs).toBe(20)
  })
  it('is all zero without frames', () => {
    expect(frameStats([])).toEqual({ frames: 0, medianMs: 0, p95Ms: 0, maxMs: 0 })
  })
})

describe('sceneBuffers', () => {
  const attr = (bytes: number) => ({ array: { byteLength: bytes }, count: 1 })
  const scene = (objects: object[]) => ({ traverse: (visit: (o: object) => void) => objects.forEach(visit) })

  it('adds up vertex and index buffers of the meshes', () => {
    const mesh = { isMesh: true, geometry: { index: attr(600), attributes: { position: attr(1200), normal: attr(300) } } }
    expect(sceneBuffers(scene([mesh, { isMesh: false }]))).toEqual({ bytes: 2100, meshes: 1, buffers: 3 })
  })
  it('counts a buffer shared by two geometries once', () => {
    const shape = attr(1000)
    const a = { isMesh: true, geometry: { index: null, attributes: { position: shape, a_tree: attr(40) } } }
    const b = { isMesh: true, geometry: { index: null, attributes: { position: shape, a_tree: attr(40) } } }
    expect(sceneBuffers(scene([a, b]))).toEqual({ bytes: 1080, meshes: 2, buffers: 3 })
  })
})
