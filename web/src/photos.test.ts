import { describe, expect, it } from 'vitest'
import { positionLabel, type PhotoProps } from './photos'

function photo(pose: PhotoProps['pose'], extra?: Record<string, unknown>): PhotoProps {
  return {
    id: 'parismusees:1',
    source: 'parismusees',
    source_id: '1',
    title: 'x',
    license: 'CC0-1.0',
    media: 'photo',
    pose,
    confidence: 0.3,
    extra: extra ? JSON.stringify(extra) : undefined
  }
}

describe('positionLabel', () => {
  it('names the address for a house number', () => {
    const p = photo('geocoded', { geocoded_street: '9 Rue Férou 75006 Paris', precision: 'number', method: 'ban' })
    expect(positionLabel(p)).toBe('At 9 Rue Férou, the address in the caption')
  })

  it('says when an address is from 1836', () => {
    const p = photo('geocoded', { geocoded_street: '12 Rue de la Calandre', precision: 'number', method: 'vasserot-1836' })
    expect(positionLabel(p)).toBe('At 12 Rue de la Calandre, the address in the caption, as numbered in 1836')
  })

  it('names both streets of a corner', () => {
    const p = photo('geocoded', { geocoded_street: 'Rue de la Calandre / Rue de la Juiverie', precision: 'corner' })
    expect(positionLabel(p)).toBe('At the corner of Rue de la Calandre and Rue de la Juiverie, named in the caption')
  })

  it('explains demolished and renamed streets', () => {
    const gone = photo('geocoded', { geocoded_street: 'Rue de la Licorne', precision: 'street', method: 'vasserot-1836' })
    expect(positionLabel(gone)).toBe('Approximate: on Rue de la Licorne, a street since demolished (where it ran in 1836)')
    const renamed = photo('geocoded', {
      geocoded_street: 'Rue de Lutèce 75004 Paris',
      precision: 'street',
      method: 'former-name',
      from_caption: 'rue de Constantine',
      ambiguous: 1
    })
    expect(positionLabel(renamed)).toBe(
      "Approximate: on Rue de Lutèce, today's name for the rue de Constantine of the caption; the caption could also mean another place"
    )
  })

  it('names gardens, bridges and city gates', () => {
    const garden = photo('geocoded', { geocoded_street: 'Jardin du Luxembourg', precision: 'place', method: 'bdtopo' })
    expect(positionLabel(garden)).toBe('Approximate: at Jardin du Luxembourg, named in the caption')
    const gate = photo('geocoded', {
      geocoded_street: "Avenue de la Porte d'Italie",
      precision: 'place',
      method: 'gate-way',
      from_caption: "porte d'Italie"
    })
    expect(positionLabel(gate)).toBe("Approximate: on Avenue de la Porte d'Italie, by the porte d'Italie of the caption (a gate of the city wall)")
  })

  it('names the building a caption names without a street', () => {
    const church = photo('geocoded', {
      geocoded_street: 'Église Saint-Julien-le-Pauvre',
      precision: 'landmark',
      method: 'merimee',
      from_caption: "Nef de l'église Saint-Julien-le-Pauvre"
    })
    expect(positionLabel(church)).toBe('At Église Saint-Julien-le-Pauvre, the building named in the caption')
  })

  it('says when the caption gives the wrong arrondissement', () => {
    const p = photo('geocoded', { geocoded_street: '5 Rue du Mail 75002 Paris', precision: 'number', method: 'ban', caption_arrondissement: 1 })
    expect(positionLabel(p)).toBe('At 5 Rue du Mail, the address in the caption; the caption says the 1st arrondissement, but it lies in the next one')
    const q = photo('geocoded', { geocoded_street: 'Rue Galande 75005 Paris', precision: 'street', method: 'ban', caption_arrondissement: 13 })
    expect(positionLabel(q)).toContain('the 13th arrondissement')
  })

  it('keeps the street wording for older records and other poses', () => {
    expect(positionLabel(photo('geocoded', { geocoded_street: 'Rue Galande 75005 Paris' }))).toBe(
      'Approximate: on Rue Galande, the street named in the caption'
    )
    expect(positionLabel(photo('geocoded', { geocoded_street: 'Cite', precision: 'quarter', from_caption: 'île de la Cité' }))).toBe(
      'Rough: somewhere in île de la Cité, named in the caption'
    )
    expect(positionLabel(photo('recorded'))).toBe('Camera position recorded by the archive')
  })
})
