/**
 * Geometry for the then-and-now viewer.
 *
 * In a 360° panorama the archive photo stays fixed at the centre of the
 * screen and people turn the panorama underneath it. Both images are
 * rectilinear, so once the view is centred on the photo the overlay only
 * needs the right width for the current zoom.
 *
 * In a flat (non-360°) street photo, people drag the archive photo over it.
 */

import { bearing, type TodayPicture } from './panoramax'

/** A typical horizontal field of view for the archive photographers' lenses. */
export const DEFAULT_PHOTO_FOV = 55
export const MIN_PHOTO_FOV = 20
export const MAX_PHOTO_FOV = 110

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Wrap an angle to [-180, 180). */
export function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180
}

/** Wrap an angle to [0, 360). */
export function wrap360(d: number): number {
  return ((d % 360) + 360) % 360
}

/**
 * Width in pixels of a photo with horizontal field of view `photoFov`
 * shown in a rectilinear view `viewWidth` pixels wide spanning `viewFov`.
 */
export function overlayWidth(viewWidth: number, viewFov: number, photoFov: number): number {
  return (viewWidth * Math.tan(rad(photoFov) / 2)) / Math.tan(rad(viewFov) / 2)
}

/** Field of view that makes a photo of `photoFov` fill `fraction` of the screen width. */
export function viewFovFor(photoFov: number, fraction: number): number {
  return deg(2 * Math.atan(Math.tan(rad(photoFov) / 2) / fraction))
}

/**
 * Saved alignment. For a 360° panorama `x` is the compass bearing and `y`
 * the pitch, in degrees. For a flat photo they are the overlay centre's
 * offset from the picture centre, in percent of the picture's width and height.
 */
export interface Alignment {
  pic: string
  x: number
  y: number
  fov: number
}

export function formatAlignment(a: Alignment): string {
  return [a.pic, a.x.toFixed(1), a.y.toFixed(1), Math.round(a.fov)].join(',')
}

export function parseAlignment(s: string | undefined | null): Alignment | undefined {
  if (!s) return undefined
  const parts = s.split(',')
  if (parts.length !== 4) return undefined
  const [pic, x, y, fov] = [parts[0], Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (!/^[\w-]{8,}$/.test(pic) || ![x, y, fov].every(Number.isFinite)) return undefined
  return { pic, x, y, fov: Math.min(MAX_PHOTO_FOV, Math.max(MIN_PHOTO_FOV, fov)) }
}

/** Where the photographer was looking: a little ahead when the heading is known. */
export function lookTarget(lonlat: [number, number], heading?: number, metres = 20): [number, number] {
  if (heading === undefined) return lonlat
  const r = rad(heading)
  return [
    lonlat[0] + (Math.sin(r) * metres) / (111320 * Math.cos(rad(lonlat[1]))),
    lonlat[1] + (Math.cos(r) * metres) / 111320
  ]
}

/** Compass bearing from today's camera to the place the archive photo shows. */
export function bearingTo(pic: TodayPicture, target: [number, number]): number {
  return bearing([pic.lon, pic.lat], target)
}

/** A starting alignment computed from positions alone. */
export function initialAlignment(pic: TodayPicture, target: [number, number]): Alignment {
  const b = bearingTo(pic, target)
  if (pic.is360) return { pic: pic.id, x: wrap360(b), y: 0, fov: DEFAULT_PHOTO_FOV }
  // Flat photo: shift the overlay sideways by the angle between the camera's
  // direction and the target, if the camera direction is known.
  let x = 0
  if (pic.azimuth !== undefined && pic.fov) {
    const off = wrap180(b - pic.azimuth)
    x = Math.max(-45, Math.min(45, (100 * Math.tan(rad(off))) / (2 * Math.tan(rad(pic.fov) / 2))))
  }
  return { pic: pic.id, x, y: 0, fov: DEFAULT_PHOTO_FOV }
}

/** Prefer 360° panoramas, then the closest picture, then the newest. */
export function bestPicture(pictures: TodayPicture[]): TodayPicture | undefined {
  return [...pictures].sort((a, b) => {
    if (a.is360 !== b.is360) return a.is360 ? -1 : 1
    if (Math.abs(a.distance - b.distance) > 5) return a.distance - b.distance
    return a.date < b.date ? 1 : -1
  })[0]
}

/** PSV yaw (radians, 0 = image centre) for a compass bearing. */
export function yawForBearing(bearingDeg: number, panoAzimuth = 0): number {
  return rad(wrap180(bearingDeg - panoAzimuth))
}

/** Compass bearing for a PSV yaw. */
export function bearingForYaw(yawRad: number, panoAzimuth = 0): number {
  return wrap360(deg(yawRad) + panoAzimuth)
}
