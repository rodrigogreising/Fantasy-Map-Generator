// Artae: a static ecology snapshot. Every node is a dungeon core whose mana budget feeds a trophic pyramid of
// archetypes (an element pair and a trophic role, named from the world profile); predation is assimilation by
// resonance, so a consumer keeps the part of its prey's essence that shares its elements and the rest becomes residual
// essence; scavengers live off the residual. One region per node (its weighted Voronoi cell of the mana field).
// Everything tunable lives in the profile's `ecology` section; nothing here evolves over time
import { ELEMENTS } from "@/artae/elements";
import { cachedField, elementLevels, findNode, nodes, type SystemNode } from "@/artae/nodes";
import { ecologyProfile, onProfile, type ProfileRole, profile } from "@/artae/profile";
import { Names } from "@/model/society/names-generator";

export interface Species {
  id: string; // role:index, unique within the region
  role: string;
  roleLabel: string;
  primary: number;
  secondary: number;
  name: string;
  level: number;
  count: number; // individuals living off the budget
  selfSustaining: number; // individuals with essence of their own, on top of the budget
  stock: number; // standing essence of the budget population
}

export interface FoodLink {
  eater: string; // species id
  food: string; // species id, or "mana" / "residual"
  flow: number; // essence consumed along the link
}

export interface Ecology {
  node: number; // node id
  cells: number; // grid cells of the region
  input: number; // the node's budget
  stock: number; // standing essence of every species
  residual: number; // essence left in the region, not assimilated by anyone
  species: Species[];
  links: FoodLink[];
  meanLevel: number; // essence-weighted mean level of the fauna
  density: number; // individuals per grid cell
  notable?: { name: string; species: string; level: number };
}

/** Stable hash of numbers and strings: same inputs, same roll, every session */
function hash(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const char of parts.join("|")) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const base = () => profile().levelBase;
const toLevel = (energy: number) => (energy > 1 ? Math.log(energy) / Math.log(base()) : 0);

/** The pair as phrases with their article, from the profile's grammar */
function phrase(primary: number, secondary: number) {
  const { grammar } = profile();
  const a = ELEMENTS[primary];
  const b = ELEMENTS[secondary];
  const feminine = a.gender === "f";
  const adjective =
    primary === secondary ? grammar.pure[feminine ? 1 : 0] : (b.adjective ?? [b.name, b.name])[feminine ? 1 : 0];
  const article = grammar.articles[a.article ?? a.gender ?? "m"];
  const noun = grammar.pair.replace("{noun}", a.name).replace("{adjective}", adjective);
  return { el: `${article.el} ${noun}`, de: `${article.de} ${noun}`, al: `${article.al} ${noun}` };
}

/** Element overlap of two pairs, 0..1: shared elements over all elements, the primary weighing double */
function overlap(a: Species, b: Species): number {
  const weights = (s: Species) => {
    const w = new Map<number, number>();
    w.set(s.primary, (w.get(s.primary) ?? 0) + 2);
    w.set(s.secondary, (w.get(s.secondary) ?? 0) + 1);
    return w;
  };
  const [wa, wb] = [weights(a), weights(b)];
  let shared = 0;
  let all = 0;
  for (const key of new Set([...wa.keys(), ...wb.keys()])) {
    shared += Math.min(wa.get(key) ?? 0, wb.get(key) ?? 0);
    all += Math.max(wa.get(key) ?? 0, wb.get(key) ?? 0);
  }
  return all ? shared / all : 0;
}

/** Grid cells of each node's region, by node index in nodes() */
function regionCells(): number[][] {
  const { owner } = cachedField();
  const regions: number[][] = nodes().map(() => []);
  for (let cell = 0; cell < owner.length; cell++) if (owner[cell] >= 0) regions[owner[cell]]?.push(cell);
  return regions;
}

const SAMPLES = 7; // cells read for a region's element mix: the node's own and a few spread through the region

/** The region's element levels, averaged over a few sample cells */
function regionLevels(node: SystemNode, cells: number[]): number[] {
  const picks = [node.node.gridCell];
  for (let k = 1; k < SAMPLES && cells.length; k++) picks.push(cells[Math.floor((k * cells.length) / SAMPLES)]);
  const sum = new Array<number>(ELEMENTS.length).fill(0);
  for (const cell of picks) for (const [e, level] of elementLevels(cell).entries()) sum[e] += level;
  return sum.map(value => value / picks.length);
}

/** The strongest ordered pairs of a region's mix, primary weighted 2:1 */
function strongPairs(levels: number[], count: number) {
  const pairs: { primary: number; secondary: number; strength: number }[] = [];
  for (let a = 0; a < levels.length; a++)
    for (let b = 0; b < levels.length; b++) {
      const strength = a === b ? levels[a] * 0.6 : (2 * levels[a] + levels[b]) / 3;
      if (strength > 0 && (a === b || levels[b] > 0)) pairs.push({ primary: a, secondary: b, strength });
    }
  return pairs.sort((x, y) => y.strength - x.strength).slice(0, count);
}

/** Entropy of the element mix, 0..1: how rich the region's magic is */
function richness(levels: number[]): number {
  const amounts = levels.map(level => (level > 0 ? base() ** level : 0));
  const total = amounts.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  const entropy = amounts.reduce((sum, value) => (value ? sum - (value / total) * Math.log(value / total) : sum), 0);
  return entropy / Math.log(levels.length || 2);
}

/** A packed cell standing on each grid cell (-1 for deep ocean the packed graph may drop), cached per map */
let packIndex: { cells: unknown; index: Int32Array } | undefined;
function packCellOf(gridCell: number): number {
  if (packIndex?.cells !== pack.cells) {
    const index = new Int32Array(grid.cells.i.length).fill(-1);
    for (let i = 0; i < pack.cells.i.length; i++) if (index[pack.cells.g[i]] < 0) index[pack.cells.g[i]] = i;
    packIndex = { cells: pack.cells, index };
  }
  return packIndex.index[gridCell] ?? -1;
}

function biomeName(gridCell: number): string {
  const packCell = packCellOf(gridCell);
  const biome = packCell >= 0 ? pack.biomes[pack.cells.biome[packCell]]?.name : undefined;
  const fallback = grid.cells.h[gridCell] < 20 ? "Marine" : "";
  const name = biome ?? fallback;
  return ecologyProfile().biomes?.[name] ?? name;
}

/** The snapshot of one node's region */
function compute(node: SystemNode, cells: number[]): Ecology {
  const eco = ecologyProfile();
  const level = node.node.level;
  const input = base() ** level;
  const levels = regionLevels(node, cells);
  const pairs = strongPairs(levels, 8);
  const biome = biomeName(node.node.gridCell);
  const rich = richness(levels);
  const age = (hash("age", node.i) % 1000) / 1000; // placeholder until nodes have an age
  const speciesCount = eco.roles.reduce((sum, role) => sum + role.archetypes, 0);
  const competition = Math.min(1, speciesCount / 12);
  const bonus = eco.bonus.age * age + eco.bonus.competition * competition + eco.bonus.richness * rich;

  // archetypes of each role: the region's strongest pairs, each role rolling its own picks among them
  const species: Species[] = [];
  const weight = new Map<string, number>();
  for (const role of eco.roles) {
    const taken = new Set<number>();
    for (let k = 0; k < Math.max(1, Math.min(3, role.archetypes)); k++) {
      let pick = hash(node.i, role.id, k) % Math.max(1, pairs.length);
      while (taken.has(pick) && taken.size < pairs.length) pick = (pick + 1) % pairs.length;
      taken.add(pick);
      const pair = pairs[pick] ?? { primary: node.node.primary, secondary: node.node.secondary, strength: 1 };
      const pattern = role.names[hash(node.i, role.id, k, "name") % role.names.length];
      const words = phrase(pair.primary, pair.secondary);
      const name = pattern
        .replace("{de}", words.de)
        .replace("{el}", words.el)
        .replace("{al}", words.al)
        .replace("{biome}", biome);
      const id = `${role.id}:${k}`;
      species.push({
        id,
        role: role.id,
        roleLabel: role.label,
        primary: pair.primary,
        secondary: pair.secondary,
        name,
        level: 0,
        count: 0,
        selfSustaining: 0,
        stock: 0
      });
      weight.set(id, pair.strength);
    }
  }
  const ofRole = (id: string) => species.filter(s => s.role === id);
  const share = (list: Species[]) => {
    const total = list.reduce((sum, s) => sum + (weight.get(s.id) ?? 0), 0) || 1;
    return (s: Species) => (weight.get(s.id) ?? 0) / total;
  };

  // feeding, role by role: consume from the prey's standing essence, keep what resonates, leave the rest as residual
  const links: FoodLink[] = [];
  let residual = 0;
  for (const role of eco.roles) {
    const eaters = ofRole(role.id);
    const part = share(eaters);
    for (const food of role.diet) {
      if (food === "mana") {
        for (const eater of eaters) {
          const consumed = input * role.eats * part(eater);
          const kept = consumed * role.efficiency;
          eater.stock += kept;
          residual += consumed - kept;
          links.push({ eater: eater.id, food: "mana", flow: consumed });
        }
        // what the producers don't take stays as residual too
        residual += input * (1 - role.eats);
      } else if (food === "residual") {
        const consumed = residual * role.eats;
        for (const eater of eaters) {
          const taken = consumed * part(eater);
          const kept = taken * role.efficiency;
          eater.stock += kept;
          residual -= kept;
          links.push({ eater: eater.id, food: "residual", flow: taken });
        }
      } else {
        for (const prey of ofRole(food)) {
          const consumed = prey.stock * role.eats;
          if (!consumed) continue;
          const affinity = eaters.map(
            eater => part(eater) * (eco.overlapFloor + (1 - eco.overlapFloor) * overlap(eater, prey))
          );
          const total = affinity.reduce((sum, value) => sum + value, 0) || 1;
          prey.stock -= consumed;
          eaters.forEach((eater, k) => {
            const taken = (consumed * affinity[k]) / total;
            const resonance = eco.overlapFloor + (1 - eco.overlapFloor) * overlap(eater, prey);
            const kept = taken * role.efficiency * resonance;
            eater.stock += kept;
            residual += taken - kept;
            links.push({ eater: eater.id, food: prey.id, flow: taken });
          });
        }
      }
    }
  }

  // levels and counts: each role sits at its share of the node's level plus the region's bonuses; the apex is one
  // creature, as strong as its standing essence allows and never above the node
  for (const s of species) {
    const role = eco.roles.find(r => r.id === s.role) as ProfileRole;
    const target = Math.min(level, level * role.levelShare + bonus);
    if (s.role === eco.apex) {
      s.level = Math.min(target, toLevel(s.stock), level);
      s.count = s.stock > 0 ? 1 : 0;
    } else {
      s.level = Math.min(target, toLevel(s.stock));
      s.count = s.stock > 0 ? Math.max(1, Math.round(s.stock / base() ** s.level)) : 0;
    }
    s.level = Math.max(0, Math.round(s.level * 10) / 10);
    s.selfSustaining = Math.round((s.count * eco.selfSustaining) / (1 - eco.selfSustaining));
  }

  const stock = species.reduce((sum, s) => sum + s.stock, 0);
  const meanLevel = stock ? species.reduce((sum, s) => sum + s.level * s.stock, 0) / stock : 0;
  const individuals = species.reduce((sum, s) => sum + s.count + s.selfSustaining, 0);
  const apex = ofRole(eco.apex).find(s => s.count);
  const packCell = packCellOf(node.node.gridCell);
  const culture = packCell >= 0 ? pack.cells.culture[packCell] : 0;
  const notable = apex
    ? {
        name: eco.notable[hash(node.i, "notable") % eco.notable.length]
          .replace("{name}", properName(node.i, culture))
          .replace("{archetype}", apex.name),
        species: apex.id,
        level: apex.level
      }
    : undefined;
  return {
    node: node.i,
    cells: cells.length,
    input,
    stock,
    residual,
    species,
    links,
    meanLevel,
    density: cells.length ? individuals / cells.length : 0,
    notable
  };
}

/** A proper name from the culture living around the node, generated once per node and session */
const properNames = new Map<number, string>();
function properName(nodeId: number, culture: number): string {
  let name = properNames.get(nodeId);
  if (!name) {
    try {
      name = Names.getCultureShort(culture || 1);
    } catch {
      name = `#${nodeId}`;
    }
    properNames.set(nodeId, name);
  }
  return name;
}

let cache: { list: unknown; map: unknown; profile: unknown; regions: Map<number, Ecology> } | undefined;
onProfile(() => {
  cache = undefined;
});

/** Every region's snapshot, by node id; computed once per nodes list, map and profile */
function all(): Map<number, Ecology> {
  if (cache && cache.list === pack.artaeNodes && cache.map === grid.cells && cache.profile === profile())
    return cache.regions;
  const list = nodes();
  const cells = regionCells();
  const regions = new Map(list.map((node, k) => [node.i, compute(node, cells[k])]));
  cache = { list: pack.artaeNodes, map: grid.cells, profile: profile(), regions };
  return regions;
}

/** The snapshot of the region of a node, by node id */
export const ecology = (nodeId: number): Ecology | undefined => all().get(nodeId);

/** The snapshot of the region holding a grid cell */
export function ecologyAt(gridCell: number): Ecology | undefined {
  const node = nodes()[cachedField().owner[gridCell]];
  return node && ecology(node.i);
}

/** One row per region: node, level, cells, mean fauna level, density, species, notable creature, essence balance */
export function ecologySummary() {
  return [...all().values()].map(region => {
    const node = findNode(region.node);
    return {
      node: node?.name ?? region.node,
      nodeLevel: node?.node.level,
      cells: region.cells,
      meanLevel: Math.round(region.meanLevel * 10) / 10,
      density: Math.round(region.density * 10) / 10,
      species: region.species.filter(s => s.count).length,
      notable: region.notable?.name,
      apexLevel: region.notable?.level,
      input: region.input,
      balance: region.input - region.stock - region.residual // 0 within rounding: the essence is all accounted for
    };
  });
}
