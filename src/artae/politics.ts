// Artae: regenerate peoples and realms on the terrain and nodes already on screen. Nodes come after the map in
// Artae's flow, so this is how realms get to feel them (see src/artae/geopolitics-costs.ts)

import { colorRealmsByEssence } from "@/artae/geopolitics";
import { applyCanonBurgs, applyCanonCultures, applyCanonStates, loadSeed, loreMap, loreReport } from "@/artae/lore";
import { loadProfile, settingOf } from "@/artae/profile";
import { nameProvinces, nameRealms } from "@/artae/realm-names";
import { Markets } from "@/model/economy/markets-generator";
import { Production } from "@/model/economy/production-generator";
import { Routes } from "@/model/economy/routes-generator";
import { Burgs } from "@/model/political/burgs-generator";
import { Military } from "@/model/political/military-generator";
import { Provinces } from "@/model/political/provinces-generator";
import { States } from "@/model/political/states-generator";
import { Zones } from "@/model/political/zones-generator";
import { Cultures } from "@/model/society/cultures-generator";
import { Population } from "@/model/society/population-generator";
import { Religions } from "@/model/society/religions-generator";
import { Layers } from "@/renderers/layers";

/** Cells still name the previous run's realms; a smaller set of new realms would not have those ids */
function clearUnlockedStates(): void {
  const { state } = pack.cells;
  for (let i = 0; i < state.length; i++) if (!pack.states[state[i]]?.lock) state[i] = 0;
}

/** The generation pipeline from cultures on, as src/model/generation-pipeline.ts runs it */
const STEPS: [string, () => unknown][] = [
  ["rankCells", () => Population.rankCells()],
  ["cultures", () => Cultures.generate()],
  ["canonCultures", () => applyCanonCultures()],
  ["culturesExpand", () => Cultures.expand()],
  ["burgs", () => Burgs.generate()],
  ["canonBurgs", () => applyCanonBurgs()],
  ["clearStates", () => clearUnlockedStates()],
  ["states", () => States.generate()],
  ["routes", () => Routes.generate()],
  ["religions", () => Religions.generate()],
  ["burgsSpecify", () => Burgs.specify()],
  ["stateStatistics", () => States.collectStatistics()],
  ["stateForms", () => States.defineStateForms()],
  ["canonStates", () => applyCanonStates()],
  ["realmNames", () => nameRealms()],
  ["provinces", () => Provinces.generate()],
  ["provinceNames", () => nameProvinces()],
  ["provincePoles", () => Provinces.getPoles()],
  ["markets", () => Markets.generate()],
  ["production", () => Production.produce()],
  ["taxes", () => States.collectTaxes()],
  ["military", () => Military.generate()],
  ["zones", () => Zones.generate()]
];

/** Rerun cultures, burgs, states, routes, religions, provinces and what hangs on them, keeping terrain and nodes.
 * The canon's `generate` entries for the repo map on screen always appear (see src/artae/lore.ts) */
export async function regeneratePolitics() {
  const map = loreMap();
  if (map) await loadProfile(settingOf(map)); // a repo map's setting decides the elements; otherwise keep the profile in use
  await loadSeed(map);
  for (const [id, run] of STEPS) {
    try {
      run();
    } catch (error) {
      throw new Error(`regeneratePolitics failed at ${id}: ${(error as Error).message}`);
    }
  }
  colorRealmsByEssence();
  Layers.drawAll();
  const alive = <T extends { i: number; removed?: boolean }>(list: T[]) => list.filter(item => item.i && !item.removed);
  return {
    cultures: alive(pack.cultures).length,
    states: alive(pack.states).length,
    burgs: alive(pack.burgs).length,
    lore: loreReport()
  };
}
