import { describe, expect, it } from 'vitest'
import { FURNITURE_RADIUS_M, nearItems } from '../src/streets'

describe('street furniture culling', () => {
  it('keeps the items standing that year near the camera', () => {
    // x, y, angle, parameter per item; life from, until, gap from, gap until.
    const inst = [0, 0, 0, 0, FURNITURE_RADIUS_M + 10, 0, 0, 0, 10, 10, 0, 0, 20, 0, 0, 0]
    const life = [1850, 1e4, 0, 0, 1850, 1e4, 0, 0, 1900, 1e4, 0, 0, 1850, 1e4, 1914, 1920]
    const eye = { x: 0, y: 0, z: 1.6 }
    expect(nearItems(inst, life, 1880, eye)).toEqual([0, 3])
    expect(nearItems(inst, life, 1950, eye)).toEqual([0, 2, 3])
    expect(nearItems(inst, life, 1915, eye)).toEqual([0, 2])
    // From high above, nothing is near.
    expect(nearItems(inst, life, 1950, { x: 0, y: 0, z: 400 })).toEqual([])
  })
})
