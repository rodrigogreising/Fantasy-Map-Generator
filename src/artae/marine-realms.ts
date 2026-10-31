// Artae: which realms live in the sea: a culture of the Marine type, and a state whose culture is Marine or whose
// capital sits on water. Provinces and religions follow these to hold sea cells (see src/artae/marine.ts)
import { MARINE_TYPE } from "@/artae/marine";
import { isWater } from "@/utils/height-utils";

export const isMarineCulture = (cultureId: number | undefined) =>
  !!cultureId && pack.cultures[cultureId]?.type === MARINE_TYPE;

export function isMarineState(stateId: number | undefined): boolean {
  const state = stateId ? pack.states[stateId] : undefined;
  if (!state || state.removed) return false;
  if (isMarineCulture(state.culture)) return true;
  const capital = state.capital ? pack.burgs[state.capital] : undefined;
  return !!capital && !capital.removed && isWater(capital.cell, pack);
}
