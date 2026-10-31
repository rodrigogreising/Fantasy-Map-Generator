// Artae: how nodes shape realms: nodes attract
// capitals and expansion, and borders often fall where two mana regions meet. Nodes pull, they do not dictate:
// terrain and culture costs stay as they are. With no nodes on the map every weight is inert
import { cachedField, nodes } from "@/artae/nodes";
import { Pack } from "@/model/graph/pack-generator";

/** The weights, in one place to tune; set them to 0 to see realms as if there were no nodes */
export const NODE_WEIGHTS = {
  capitalBonus: 12, // added to a cell's capital score at full mana level (30), less where the mana is weaker
  townBonus: 8, // towns: extra cell score at a level-30 mana spot, so towns cluster where mana is strong
  pull: 60, // cost discount for entering a mana region whose node no realm holds yet, at node level 30
  borderCost: 400, // extra cost for stepping from one mana region into another: borders tend to settle there
  contested: 300 // extra cost per cell inside a mana region another realm reached first
};

export interface PackMana {
  region(cell: number): number; // index of the node whose mana dominates the cell, -1 if none
  level(cell: number): number; // mana level there, 0..30
  nodeLevel(region: number): number;
  nodeCell(region: number): number; // packed cell the node stands on
}

/** The mana field read on packed cells, or undefined when the map has no nodes */
export function manaOnPack(): PackMana | undefined {
  const list = nodes();
  if (!list.length) return undefined;
  const { owner, level } = cachedField();
  const g = pack.cells.g;
  const cells = list.map(({ x, y }) => Pack.findCell(x, y) ?? -1);
  return {
    region: cell => owner[g[cell]],
    level: cell => level[g[cell]],
    nodeLevel: region => list[region]?.node.level ?? 0,
    nodeCell: region => cells[region]
  };
}

/** Marine realms: many and small. The seas hold as many realms per populated cell as the land, times `density`;
 * a marine realm stops growing at `reach` of a land realm's cost limit, and never holds more than `size` times an
 * average land realm's area, so open ocean stays unclaimed */
export const MARINE_REALMS = { density: 1, reach: 0.1, size: 1 };
