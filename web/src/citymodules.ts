/**
 * Layers of detail added to the 3D city, each in its own file. A module
 * exports a default CityModule (see city3d.ts). Uncomment a line once its
 * file exists; modules load in parallel and one that fails is skipped.
 */

import type { CityModule } from './city3d'

export const CITY_MODULES: (() => Promise<{ default: CityModule }>)[] = [
  () => import('./institutions'),

  // () => import('./landmarks'),

  // () => import('./streets'),

  () => import('./vehicles'),

  // () => import('./island')
]
