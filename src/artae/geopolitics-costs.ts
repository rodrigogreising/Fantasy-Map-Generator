// Artae: how nodes shape realms: nodes attract
// capitals and expansion, and borders often fall where two mana regions meet. Nodes pull, they do not dictate:
// terrain and culture costs stay as they are. With no nodes on the map every weight is inert
import { cachedField, nodes } from "@/artae/nodes";
import { profile } from "@/artae/profile";
import { Pack } from "@/model/graph/pack-generator";

/** The weights, in one place to tune; set them to 0 to see realms as if there were no nodes */
export const NODE_WEIGHTS = {
  capitalBonus: 12, // added to a cell's capital score at full mana level (30), less where the mana is weaker
  townBonus: 8, // towns: extra cell score at a level-30 mana spot, so towns cluster where mana is strong
  capitalSeat: 3000, // capitals: extra score on a node's core and the cells next to it, at node level 30
  townSeat: 600, // towns: extra score on a node's core and the cells next to it, at node level 30
  pull: 200, // cost discount for entering a mana region whose node no realm holds yet, at node level 30
  borderCost: 600, // extra cost for stepping from one mana region into another: borders tend to settle there
  contested: 800 // extra cost per cell inside a mana region another realm reached first
};

/** A node's core cell and the cells within `radius` steps of it: their score bonus, `weight` at a level-30 node,
 * fading with each step out. Several nodes keep the strongest */
export function nodeSeats(mana: PackMana, weight: number, radius = 2): Float32Array {
  const { cells } = pack;
  const bonus = new Float32Array(cells.i.length);
  for (let region = 0; region < nodes().length; region++) {
    const core = mana.nodeCell(region);
    if (core < 0) continue;
    const strength = (weight * mana.nodeLevel(region)) / 30;
    const seen = new Set([core]);
    let ring = [core];
    for (let step = 0; step <= radius && ring.length; step++) {
      const value = strength * (1 - step / (radius + 1));
      for (const cell of ring) bonus[cell] = Math.max(bonus[cell], value);
      const next: number[] = [];
      for (const cell of ring)
        for (const neighbor of cells.c[cell])
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            next.push(neighbor);
          }
      ring = next;
    }
  }
  return bonus;
}

/** The cell at or nearest a node's core (within two steps) that passes `fits`, or undefined */
export function seatNear(mana: PackMana, region: number, fits: (cell: number) => boolean): number | undefined {
  const { cells } = pack;
  const core = mana.nodeCell(region);
  if (core < 0) return undefined;
  const rings = [[core], cells.c[core], cells.c[core].flatMap(c => cells.c[c])];
  return rings.flat().find(fits);
}

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

/** Each realm's might from the nodes it holds (sum of base^level), indexed by state id; undefined with no nodes.
 * Diplomacy uses it instead of area: the realm holding the biggest nodes around is the one others submit to */
export function realmMight(stateCount: number): Float64Array | undefined {
  const list = nodes();
  if (!list.length) return undefined;
  const base = profile().levelBase;
  const might = new Float64Array(stateCount);
  for (const { x, y, node } of list) {
    const cell = Pack.findCell(x, y);
    const state = cell === undefined ? 0 : pack.cells.state[cell];
    if (state) might[state] += base ** node.level;
  }
  return might;
}
