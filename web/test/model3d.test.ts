import { describe, expect, it } from 'vitest'
import { describeBuilding, existsIn, modelFilter } from '../src/model3d'

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

describe('building popup text', () => {
  it('says when a height is estimated and links to the plan', () => {
    const d = describeBuilding({
      kind: 'reconstructed', height: 15.2, period: 'standing in 1836, since demolished', traced: true, iou: 0.83,
      address: 'Marmousets (rue des) n°17', plan_url: 'https://www.siv.archives-nationales.culture.gouv.fr/siv/UD/FRAN_IR_058572/d_8158',
      source: "Footprint traced from Vasserot's plan of the building; height estimated"
    })
    expect(d.title).toBe('Marmousets (rue des) n°17')
    expect(d.lines[1]).toBe('Height: about 15 m (estimated)')
    expect(d.lines[2]).toContain('fit 83%')
    expect(d.link?.href).toContain('archives-nationales')
  })
  it('reports measured heights for surviving buildings', () => {
    const d = describeBuilding({ kind: 'standing', height: 66.7, height_max: 70.3, period: 'before 1800', source: 'APUR' })
    expect(d.lines[0]).toBe('Built before 1800, still standing')
    expect(d.lines[1]).toBe('Height: 67 m median, 70 m at the highest (measured)')
  })
})
