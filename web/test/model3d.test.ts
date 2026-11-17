import { describe, expect, it } from 'vitest'
import { existsIn, modelFilter } from '../src/model3d'

describe('3D model over time', () => {
  it('keeps surviving buildings in every year', () => {
    expect(existsIn({ kind: 'standing' }, 1790)).toBe(true)
    expect(existsIn({ kind: 'standing' }, 2026)).toBe(true)
  })
  it('removes demolished buildings from 1860', () => {
    expect(existsIn({ kind: 'reconstructed', until: 1860 }, 1859)).toBe(true)
    expect(existsIn({ kind: 'reconstructed', until: 1860 }, 1860)).toBe(false)
  })
  it('adds later buildings from their construction period', () => {
    expect(existsIn({ kind: 'later', from: 1877 }, 1876)).toBe(false)
    expect(existsIn({ kind: 'later', from: 1877 }, 1877)).toBe(true)
  })
  it('puts the year into the MapLibre filter', () => {
    expect(JSON.stringify(modelFilter(1900))).toContain('1900')
  })
})
