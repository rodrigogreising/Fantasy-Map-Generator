// Artae: marine life: the seas are inhabited, densest in warm shallow water by the coast, thinner in cold or deep
// water, never empty. Shared by population, cultures and (later) states, provinces, religions, burgs and sea routes
import { isWater } from "@/utils/height-utils";

export const MARINE_TYPE = "Marine";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Habitability of a water cell on the biome scale (0..100); land cells return 0 */
export function marineHabitability(cellId: number): number {
  const { cells } = pack;
  if (!isWater(cellId, pack)) return 0;
  const temp = grid.cells.temp[cells.g[cellId]];
  if (temp < -8) return 2; // frozen sea: a few hardy peoples under the ice
  const shallow = clamp(cells.h[cellId] / 19); // 1 at the shore, 0 in the abyss
  const warmth = clamp((temp + 5) / 30);
  const t = cells.t[cellId];
  const coastal = t === -1 ? 1 : t === -2 ? 0.8 : t < 0 ? 0.6 ** (-t - 2) : 0; // t is 0 past the marked distance
  return Math.round(6 + 55 * shallow * warmth + 25 * coastal * warmth + 8 * shallow);
}

/** A cell marine peoples can hold: any water, and land only on the coast (the first two rings) */
export const isMarineReach = (cellId: number) => isWater(cellId, pack) || pack.cells.t[cellId] <= 2;

/** A cell land peoples can hold: any land, and water only next to the shore */
export const isLandReach = (cellId: number) => !isWater(cellId, pack) || pack.cells.t[cellId] === -1;

/** Share of all habitability that is marine: how many of the generated peoples should live in the sea */
export function marineShare(): number {
  const { cells } = pack;
  let sea = 0;
  let total = 0;
  for (const i of cells.i) {
    const s = Math.max(0, cells.s[i]);
    total += s * cells.area[i];
    if (isWater(i, pack)) sea += s * cells.area[i];
  }
  return total ? sea / total : 0;
}
