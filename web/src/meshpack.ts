/**
 * Compact GPU buffers for the city's meshes.
 *
 * citygen.ts writes triangles through MeshData.vertex (three vertices each)
 * or MeshData.quad (four corners, two triangles, in MeshData.index). Here
 * identical vertices are merged behind one index buffer, normals become
 * bytes and the years of `a_life` 16-bit integers. The pick code still maps
 * triangle i to owner[i]: triangles keep their order.
 */

import type { MeshData } from './citygen'

export interface PackedMesh {
  position: Float32Array
  /** Unit normals as signed bytes (normalized attribute). */
  normal: Int8Array
  a: Float32Array
  b: Float32Array
  /** Facade details (a_c), or null when the mesh has none. */
  c: Float32Array | null
  /** Years as 16-bit integers (enough for -10000 to 10000). */
  life: Int16Array
  index: Uint32Array | Uint16Array
  vertices: number
}

const toByte = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)))
const toShort = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v)))

/** Merge identical vertices (after quantising normals and years) behind an index. */
export function packMesh(m: MeshData): PackedMesh {
  const n = m.position.length / 3
  const hasC = m.c.length === n * 4 && m.c.some((v) => v !== 0)
  const position = new Float32Array(n * 3)
  const normal = new Int8Array(n * 3)
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  const c = hasC ? new Float32Array(n * 4) : null
  const life = new Int16Array(n * 4)
  const remap = new Uint32Array(n)
  let size = 1
  while (size < n * 2) size <<= 1
  const table = new Int32Array(size).fill(-1)
  const mask = size - 1
  // Scratch: the candidate vertex as float32 values, read back as bits for hashing.
  const F = hasC ? 15 : 11
  const f = new Float32Array(15)
  const bits = new Uint32Array(f.buffer)
  const q = new Int32Array(7)
  let count = 0
  for (let i = 0; i < n; i++) {
    f[0] = m.position[i * 3]
    f[1] = m.position[i * 3 + 1]
    f[2] = m.position[i * 3 + 2]
    for (let k = 0; k < 4; k++) {
      f[3 + k] = m.a[i * 4 + k]
      f[7 + k] = m.b[i * 4 + k]
      if (hasC) f[11 + k] = m.c[i * 4 + k]
    }
    q[0] = toByte(m.normal[i * 3])
    q[1] = toByte(m.normal[i * 3 + 1])
    q[2] = toByte(m.normal[i * 3 + 2])
    for (let k = 0; k < 4; k++) q[3 + k] = toShort(m.life[i * 4 + k])
    let h = 2166136261
    for (let k = 0; k < F; k++) h = Math.imul(h ^ bits[k], 16777619)
    for (let k = 0; k < 7; k++) h = Math.imul(h ^ (q[k] & 0xffff), 16777619)
    let slot = (h >>> 0) & mask
    let found = -1
    while (table[slot] !== -1) {
      const j = table[slot]
      let same = normal[j * 3] === q[0] && normal[j * 3 + 1] === q[1] && normal[j * 3 + 2] === q[2]
      for (let k = 0; same && k < 4; k++) same = life[j * 4 + k] === q[3 + k]
      for (let k = 0; same && k < 3; k++) same = position[j * 3 + k] === f[k]
      for (let k = 0; same && k < 4; k++) same = a[j * 4 + k] === f[3 + k] && b[j * 4 + k] === f[7 + k] && (!c || c[j * 4 + k] === f[11 + k])
      if (same) {
        found = j
        break
      }
      slot = (slot + 1) & mask
    }
    if (found < 0) {
      found = count++
      table[slot] = found
      position.set(f.subarray(0, 3), found * 3)
      a.set(f.subarray(3, 7), found * 4)
      b.set(f.subarray(7, 11), found * 4)
      if (c) c.set(f.subarray(11, 15), found * 4)
      normal[found * 3] = q[0]
      normal[found * 3 + 1] = q[1]
      normal[found * 3 + 2] = q[2]
      life.set(q.subarray(3, 7), found * 4)
    }
    remap[i] = found
  }
  // Triangles in owner order: MeshData's own index when it covers every
  // triangle, else three consecutive vertices per triangle.
  const tris = m.owner.length
  const indexed = m.index.length === tris * 3
  const index = count > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3)
  for (let i = 0; i < tris * 3; i++) index[i] = remap[indexed ? m.index[i] : i]
  return {
    position: position.slice(0, count * 3),
    normal: normal.slice(0, count * 3),
    a: a.slice(0, count * 4),
    b: b.slice(0, count * 4),
    c: c ? c.slice(0, count * 4) : null,
    life: life.slice(0, count * 4),
    index,
    vertices: count
  }
}
