/**
 * The great institutions of the old Cité: the Hôtel-Dieu (wards on the
 * island until 1878, the left-bank annex until 1909), Boffrand's
 * Enfants-Trouvés on the parvis (until 1877) and the archbishop's palace
 * (sacked in February 1831, razed after 1837). Their footprints are traced
 * from Verniquet's atlas by `python -m rpr institutions` and come with the
 * model; this module gives them their facades (institutionshaders.ts) and
 * slate mansards, and the palace's burned shell between 1831 and 1837.
 */

import type { CityModule, CityProps } from './city3d'
import { ROOF_MATERIAL } from './citygen'

export const INSTITUTION_STYLE = { hotelDieu: 10, enfantsTrouves: 11, palace: 12, palaceRuin: 13 } as const

interface InstitutionProps extends CityProps {
  institution?: string
  institution_style?: number
  ruin?: boolean
}

/** Style and roof of one institution building. */
export function institutionLook(p: InstitutionProps): { style: number; roof: 'flat' | 'mansard'; roofMaterial: number } | undefined {
  if (!p.institution) return undefined
  if (p.ruin) return { style: INSTITUTION_STYLE.palaceRuin, roof: 'flat', roofMaterial: ROOF_MATERIAL.mineral }
  return { style: p.institution_style ?? INSTITUTION_STYLE.hotelDieu, roof: 'mansard', roofMaterial: ROOF_MATERIAL.lead }
}

const institutions: CityModule = {
  name: 'institutions',
  prepare(ctx) {
    ctx.buildings.props.forEach((p, i) => {
      const look = institutionLook(p as InstitutionProps)
      if (!look) return
      const spec = ctx.buildings.specs[i]
      spec.style = look.style
      spec.roof = look.roof
      spec.roofMaterial = look.roofMaterial
    })
  }
}

export default institutions
