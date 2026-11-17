import { describe, expect, it } from 'vitest'
import {
  bearingForYaw,
  bestPicture,
  formatAlignment,
  initialAlignment,
  lookTarget,
  overlayWidth,
  parseAlignment,
  viewFovFor,
  wrap180,
  wrap360,
  yawForBearing
} from '../src/alignment'
import type { TodayPicture } from '../src/panoramax'

const pic = (p: Partial<TodayPicture>): TodayPicture => ({
  id: 'b03f8041-2b5b-498f-8214-d51e04bb3db4', lon: 2.35, lat: 48.853, date: '2025-10-09', is360: true,
  thumb: 't', sd: 's', hd: 'h', license: 'CC-BY-SA-4.0', distance: 20, viewerUrl: 'v', ...p
})

describe('angles', () => {
  it('wraps', () => {
    expect(wrap180(190)).toBe(-170)
    expect(wrap180(-190)).toBe(170)
    expect(wrap360(-10)).toBe(350)
  })
  it('converts between compass bearings and viewer yaw', () => {
    expect(yawForBearing(100, 90)).toBeCloseTo((10 * Math.PI) / 180)
    expect(bearingForYaw(yawForBearing(5, 350), 350)).toBeCloseTo(5)
  })
})

describe('overlay size', () => {
  it('fills the screen when the photo and the view have the same field of view', () => {
    expect(overlayWidth(1000, 60, 60)).toBeCloseTo(1000)
  })
  it('halves with a narrower photo in rectilinear projection', () => {
    // tan(16.1°) / tan(30°) ≈ 0.5
    expect(overlayWidth(1000, 60, 32.2)).toBeCloseTo(500, -1)
  })
  it('inverts', () => {
    const v = viewFovFor(55, 0.75)
    expect(overlayWidth(1000, v, 55)).toBeCloseTo(750)
  })
})

describe('alignment in the URL', () => {
  it('round-trips', () => {
    const a = { pic: 'b03f8041-2b5b-498f-8214-d51e04bb3db4', x: 123.45, y: -3.21, fov: 61.6 }
    const back = parseAlignment(formatAlignment(a))!
    expect(back.pic).toBe(a.pic)
    expect(back.x).toBeCloseTo(123.5)
    expect(back.fov).toBe(62)
  })
  it('rejects junk and clamps the field of view', () => {
    expect(parseAlignment('x,1,2')).toBeUndefined()
    expect(parseAlignment('bad id!,1,2,3')).toBeUndefined()
    expect(parseAlignment('b03f8041-2b5b,0,0,500')?.fov).toBe(110)
  })
})

describe('starting point', () => {
  it('looks from the panorama toward the photographed place', () => {
    const target: [number, number] = [2.35, 48.854] // due north of the panorama
    const a = initialAlignment(pic({}), target)
    expect(a.x).toBeCloseTo(0, 0)
    expect(a.y).toBe(0)
  })
  it('offsets the overlay in a flat photo when the target is off-centre', () => {
    const target: [number, number] = [2.351, 48.853] // due east
    const a = initialAlignment(pic({ is360: false, azimuth: 60, fov: 76 }), target)
    expect(a.x).toBeGreaterThan(20)
  })
  it('projects the look target ahead along the heading', () => {
    const [lon, lat] = lookTarget([2.35, 48.85], 90, 20)
    expect(lat).toBeCloseTo(48.85, 6)
    expect(lon).toBeGreaterThan(2.35)
  })
  it('prefers 360° panoramas, then the closest', () => {
    const best = bestPicture([
      pic({ id: 'flat-near-aaaa', is360: false, distance: 5 }),
      pic({ id: 'pano-far-aaaaa', is360: true, distance: 40 }),
      pic({ id: 'pano-near-aaaa', is360: true, distance: 12 })
    ])
    expect(best?.id).toBe('pano-near-aaaa')
  })
})
