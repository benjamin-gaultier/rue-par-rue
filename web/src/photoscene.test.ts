import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { paintable, photoMatrices } from './photoscene'
import { sceneFor, type SceneEntry } from './standin'
import type { Camera } from './photos'

const cam = { bearing: 90, pitch: 0, roll: 0, hfov: 60, shift: 0.2 }
const eye = new THREE.Vector3(10, 20, 1.5)

/** Where a point lands in the picture: u from the left, v from the top, both 0 to 1. */
function picture(c: typeof cam, p: [number, number, number], aspect = 1.5) {
  const v = new THREE.Vector4(...p, 1).applyMatrix4(photoMatrices(c, eye, aspect).viewProj)
  return { u: (v.x / v.w + 1) / 2, v: 1 - (v.y / v.w + 1) / 2, ahead: v.w }
}

describe('photoMatrices', () => {
  it('puts the point straight ahead below the middle by the rising front', () => {
    const at = picture(cam, [30, 20, 1.5]) // 20 m east, at eye height
    expect(at.u).toBeCloseTo(0.5)
    expect(at.v).toBeCloseTo(0.7)
    expect(at.ahead).toBeCloseTo(20)
  })

  it('spans the horizontal field of view across the picture', () => {
    const t = Math.tan(Math.PI / 6) // half of 60 degrees
    expect(picture(cam, [30, 20 - 20 * t, 1.5]).u).toBeCloseTo(1) // to the right of east is south
    expect(picture(cam, [30, 20 + 20 * t, 1.5]).u).toBeCloseTo(0)
  })

  it('keeps the picture’s proportions upward', () => {
    const t = Math.tan(Math.PI / 6) / 1.5 // half the height, for a picture 1.5 times wider than tall
    expect(picture(cam, [30, 20, 1.5 + 20 * t]).v).toBeCloseTo(0.2)
  })

  it('looks up with the pitch and turns the picture with the roll', () => {
    const up = picture({ ...cam, pitch: 10 }, [30, 20, 1.5])
    expect(up.v).toBeGreaterThan(0.7) // the horizon falls in the picture
    // Turned clockwise, a point on the right of the axis rises in the picture.
    const right = picture({ ...cam, roll: 5 }, [30, 15, 1.5])
    const level = picture(cam, [30, 15, 1.5])
    expect(right.v).toBeLessThan(level.v)
  })
})

describe('paintable', () => {
  const geometry = (attrs: string[]) => {
    const g = new THREE.BufferGeometry()
    for (const a of attrs) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(12), a === 'position' || a === 'normal' ? 3 : 4))
    return g
  }
  it('takes model meshes with years and normals, not water, decals or instances', () => {
    const plain = new THREE.ShaderMaterial({ name: 'walls' })
    expect(paintable(new THREE.Mesh(geometry(['position', 'normal', 'a_life']), plain))).toBe(true)
    expect(paintable(new THREE.Mesh(geometry(['position', 'normal']), plain))).toBe(false)
    expect(paintable(new THREE.Mesh(geometry(['position', 'normal', 'a_life']), new THREE.ShaderMaterial({ name: 'water' })))).toBe(false)
    expect(paintable(new THREE.Mesh(geometry(['position', 'normal', 'a_life']), new THREE.ShaderMaterial({ depthWrite: false })))).toBe(false)
    const inst = new THREE.InstancedBufferGeometry()
    inst.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    expect(paintable(new THREE.Mesh(inst, plain))).toBe(false)
  })
})

describe('sceneFor', () => {
  const entry: SceneEntry = { image: 'a.jpg', mask: 'a-mask.png', width: 800, height: 600, crop: [0.1, 0.2, 0.9, 0.8], sky: 0.3, leaves: 0, covered: 0 }
  const camera = { crop: [0.1, 0.2, 0.9, 0.8] } as Camera
  it('uses a scene only when it was cut with the camera’s crop', () => {
    expect(sceneFor({ a: entry }, 'a', camera)).toBe(entry)
    expect(sceneFor({ a: entry }, 'b', camera)).toBeUndefined()
    expect(sceneFor({ a: entry }, 'a', { ...camera, crop: [0.1, 0.2, 0.9, 0.75] })).toBeUndefined()
  })
})
