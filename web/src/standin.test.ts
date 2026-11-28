import { describe, expect, it } from 'vitest'
import { between, ease, frameFor, metresBetween, nearestPosed, pictureAspect, poseEntry, viewOf } from './standin'
import { cameraLabel, cameraOf, parseCrop, type Camera, type PhotoProps } from './photos'

const camera: Camera = { lon: 2.3489, lat: 48.8535, height: 1.6, bearing: 100, pitch: 1, roll: 0, hfov: 60, method: 'manual', confidence: 0.5, crop: [0, 0, 1, 1], shift: 0 }

describe('frameFor', () => {
  it('fits a wide photo to the width and matches its field of view', () => {
    const f = frameFor(1440, 1000, 16 / 9, 60, { x: 20, top: 100, bottom: 100 })
    expect(f.w).toBe(1400)
    expect(f.h).toBeCloseTo(1400 / (16 / 9))
    expect(f.x).toBe(20)
    expect(f.y + f.h / 2).toBeCloseTo(500) // centred on the vanishing point
    // The frame's half-width sees half the field of view.
    const focal = 500 / Math.tan((f.vfov * Math.PI) / 360)
    expect((2 * Math.atan(700 / focal) * 180) / Math.PI).toBeCloseTo(60)
  })

  it('fits a tall photo to the height', () => {
    const f = frameFor(1440, 900, 0.75, 40, { x: 20, top: 100, bottom: 100 })
    expect(f.h).toBe(700)
    expect(f.w).toBeCloseTo(525)
    expect(f.x + f.w / 2).toBeCloseTo(720)
  })

  it('puts the horizon of a raised lens on the vanishing point', () => {
    const f = frameFor(1440, 1000, 1.5, 60, { x: 20, top: 20, bottom: 200 }, 0.25)
    expect(f.h).toBeCloseTo(640) // the top margin limits it: three quarters of the picture above the centre
    expect(f.y).toBeCloseTo(20)
    expect(f.y + 0.75 * f.h).toBeCloseTo(500)
    expect(f.y + f.h).toBeLessThanOrEqual(800) // clear of the card
  })
})

describe('moving to the camera', () => {
  it('turns the short way round', () => {
    const a = { pos: [0, 0] as [number, number], heading: 350, lookUp: 0, height: 2, roll: 0 }
    const b = { ...a, heading: 10 }
    expect(between(a, b, 0.5).heading).toBeCloseTo(0)
    expect(between(b, a, 0.5).heading).toBeCloseTo(0)
  })

  it('eases from rest to rest', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.5)
  })

  it('stands at the camera', () => {
    expect(viewOf(camera)).toEqual({ pos: [2.3489, 48.8535], heading: 100, lookUp: 1, height: 1.6, roll: 0 })
  })
})

describe('the photo near you', () => {
  const near = { id: 'a', camera }
  const far = { id: 'b', camera: { ...camera, lon: 2.352 } }

  it('measures metres', () => {
    expect(metresBetween([2.3489, 48.8535], [2.3489, 48.8545])).toBeCloseTo(110.6, 0)
  })

  it('offers the nearest within reach, or nothing', () => {
    expect(nearestPosed([far, near], [2.3490, 48.8535], 40)?.id).toBe('a')
    expect(nearestPosed([far], [2.3490, 48.8535], 40)).toBeUndefined()
  })
})

describe('the picture inside the image', () => {
  it('takes its proportions from the crop', () => {
    expect(pictureAspect(1371, 1080, [0.1889, 0.2204, 0.8001, 0.6611])).toBeCloseTo(1.76, 2)
  })

  it('reads a crop, or the whole image', () => {
    expect(parseCrop('0.1,0.2,0.9,0.8')).toEqual([0.1, 0.2, 0.9, 0.8])
    expect(parseCrop(undefined)).toEqual([0, 0, 1, 1])
    expect(parseCrop('0.9,0.2,0.1,0.8')).toEqual([0, 0, 1, 1])
  })

  it('reads the camera with its crop from the properties', () => {
    const p = {
      camera_lon: 2.3489, camera_lat: 48.8535, camera_height: 1.6, camera_bearing: 100, camera_pitch: 1, camera_roll: 0,
      camera_hfov: 60, camera_method: 'manual', camera_confidence: 0.5, camera_crop: '0.1,0.2,0.9,0.8'
    } as unknown as PhotoProps
    expect(cameraOf(p)?.crop).toEqual([0.1, 0.2, 0.9, 0.8])
    expect(cameraOf(p)?.shift).toBe(0)
    expect(cameraOf({ ...p, camera_shift: 0.22 })?.shift).toBe(0.22)
  })
})

describe('saying how the camera was placed', () => {
  it('says a pose by hand is approximate', () => {
    expect(cameraLabel(camera, 1865)).toMatch(/^Camera placed by hand against the 3D model of 1865: approximate/)
  })

  it('gives the error of a pose from points', () => {
    expect(cameraLabel({ ...camera, points: 6, reprojectionError: 0.012 })).toMatch(/from 6 matching points \(average error 1.2%/)
  })

  it('writes an entry for the poses file', () => {
    const entry = JSON.parse(poseEntry('parismusees:1', camera, '2026-11-27'))
    expect(entry).toMatchObject({ id: 'parismusees:1', confidence: 0.5, date: '2026-11-27', camera: { bearing: 100, hfov: 60 } })
  })
})
