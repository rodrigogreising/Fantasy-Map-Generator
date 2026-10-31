// Upgrade a map saved before the packed graph kept the deep ocean: rebuild the pack from the same grid (terrain and
// climate untouched), redo the pack-level physical steps, keep the nodes, then regenerate peoples and
// realms so marine civilizations and node-aware borders appear. Follows the heightmap editor's erase pipeline
import { regeneratePolitics } from "@/artae/politics";
import { Goods } from "@/model/economy/goods-generator";
import { Pack } from "@/model/graph/pack-generator";
import { Biomes } from "@/model/physical/biomes-generator";
import { Features } from "@/model/physical/features-generator";
import { Ice } from "@/model/physical/ice-generator";
import { Rivers } from "@/model/physical/river-generator";
import { Markers } from "@/model/story/markers-generator";
import { Layers } from "@/renderers/layers";

const STEPS: [string, () => unknown][] = [
  ["regraph", () => Pack.generate(true)],
  ["markupPack", () => Features.markupPack()],
  ["rivers", () => Rivers.generate()],
  ["biomes", () => Biomes.define()],
  ["featureGroups", () => Features.defineGroups()],
  ["ice", () => Ice.generate()],
  ["goods", () => Goods.generate()]
];

const AFTER_POLITICS: [string, () => unknown][] = [
  ["riversSpecify", () => Rivers.specify()],
  ["featureNames", () => Features.defineNames()],
  ["markers", () => Markers.generate()]
];

function run(steps: [string, () => unknown][]): void {
  for (const [id, step] of steps) {
    try {
      step();
    } catch (error) {
      throw new Error(`upgradeMap failed at ${id}: ${(error as Error).message}`);
    }
  }
}

/** Rebuild the map on screen with the deep ocean in the packed graph, keeping terrain and nodes */
export async function upgradeMap() {
  const nodes = pack.artaeNodes ?? [];
  const cellsBefore = pack.cells.i.length;
  Object.assign(pack, { cultures: [], burgs: [], states: [], provinces: [], religions: [], relief: [], journeys: [] });

  run(STEPS);
  pack.artaeNodes = nodes;
  const politics = await regeneratePolitics();
  run(AFTER_POLITICS);
  Layers.drawAll();

  return { cellsBefore, cellsAfter: pack.cells.i.length, nodes: nodes.length, ...politics };
}
