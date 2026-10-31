// Lore-friendly generation: every politics run invents positions and filler, but the canon's `generate` entries for
// the map (cultures, states, burgs; see the map skill) always appear, named as the canon names them, where their
// elements are strong. Canon-made entities carry `artae: <canon id>` so anchors survive regeneration
import { ELEMENTS } from "@/artae/elements";
import { affinity, elementLevels, nodes, type SystemNode } from "@/artae/nodes";
import { Pack } from "@/model/graph/pack-generator";
import type { Burg } from "@/model/political/burgs-generator";
import type { State } from "@/model/political/states-generator";
import { CULTURE_TYPES, type Culture, type CultureType } from "@/model/society/cultures-generator";
import { Names } from "@/model/society/names-generator";
import { log } from "@/utils/logger";

declare module "@/model/society/cultures-generator" {
  interface Culture {
    artae?: string;
  }
}
declare module "@/model/political/burgs-generator" {
  interface Burg {
    artae?: string;
  }
}
declare module "@/model/political/states-generator" {
  interface State {
    artae?: string;
  }
}

interface SeedCulture {
  id: string;
  title: string;
  elements: string[];
  type?: string;
  names: string[];
}
interface SeedState {
  id: string;
  title: string;
  culture?: string;
}
interface SeedBurg {
  id: string;
  title: string;
  culture?: string;
  capital: boolean;
  near: string[];
  node?: string[]; // pinned to the strongest node of this ordered pair: the nearest town to it
}
export interface Seed {
  map: string;
  cultures: SeedCulture[];
  states: SeedState[];
  burgs: SeedBurg[];
  warnings: string[];
}

const EMPTY: Seed = { map: "", cultures: [], states: [], burgs: [], warnings: [] };
const CANDIDATES = 40; // a canon culture's centre is drawn from this many best cells, so each run differs
const NODE_BONUS = 0.25; // extra score next to a node of the culture's own pair

let seed: Seed = EMPTY;
let report: string[] = [];

/** Fetch the canon seed of a repo map; no map, no seed */
export async function loadSeed(map: string | undefined): Promise<Seed> {
  seed = EMPTY;
  report = [];
  if (!map) return seed;
  const response = await fetch(`/artae/api/seed/${map}`);
  seed = response.ok ? ((await response.json()) as Seed) : EMPTY;
  for (const warning of seed.warnings) log.warn(`Canon seed: ${warning}`);
  return seed;
}

export const loreReport = () => ({ map: seed.map, placed: report, warnings: seed.warnings });

const elementIndex = (names: string[]) =>
  names.map(name => ELEMENTS.findIndex(element => element.name === name)).filter(index => index >= 0);

/** Mana levels per grid cell, cached for one regeneration (computing them walks every node) */
const manaCache = new Map<number, number[]>();
const manaAt = (g: number) => {
  let levels = manaCache.get(g);
  if (!levels) {
    levels = elementLevels(g);
    manaCache.set(g, levels);
  }
  return levels;
};

/** How well a packed cell expresses elements, 0..1: mostly the mana its nodes bring there (where the lore says a
 * people's magic is), a little the terrain affinity to break ties. The first element weighs double, as in node pairs */
function fit(cell: number, elements: number[]): number {
  if (!elements.length) return 0;
  const { value } = affinity();
  const g = pack.cells.g[cell];
  const mana = manaAt(g);
  const weights = elements.map((_, k) => (k === 0 ? 2 : 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const manaFit = elements.reduce((sum, e, k) => sum + Math.min(1, mana[e] / 30) * weights[k], 0) / total;
  const terrainFit = elements.reduce((sum, e, k) => sum + value[e][g] * weights[k], 0) / total;
  return manaFit * 0.8 + terrainFit * 0.2;
}

/** Bonus for cells near a node holding these elements */
function nodeBonus(elements: number[]): (cell: number) => number {
  if (!elements.length) return () => 0;
  const own = nodes().filter(({ node }) => elements.includes(node.primary) && elements.includes(node.secondary));
  if (!own.length) return () => 0;
  const reach = (options.map.graph.width + options.map.graph.height) / 40;
  return cell => {
    const [x, y] = pack.cells.p[cell];
    const nearest = Math.min(...own.map(node => Math.hypot(node.x - x, node.y - y)));
    return NODE_BONUS * Math.exp(-nearest / reach);
  };
}

const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/** A custom name base per canon culture with a names list, reused across runs */
function nameBase(culture: SeedCulture): number | undefined {
  if (culture.names.length < 2) return undefined;
  const name = `Artae: ${culture.title}`;
  const lengths = culture.names.map(entry => entry.length);
  const base = {
    name,
    i: 0,
    min: Math.max(3, Math.min(...lengths) - 1),
    max: Math.max(...lengths) + 1,
    d: "",
    m: 0,
    b: culture.names.join(",")
  };
  let index = Names.nameBases.findIndex(entry => entry.name === name);
  if (index < 0) index = Names.nameBases.length;
  Names.nameBases[index] = { ...base, i: index };
  Names.updateChain(index);
  return index;
}

const living = <T extends { i: number; removed?: boolean }>(list: T[]) => list.filter(item => item.i && !item.removed);

/** After Cultures.generate: turn procedural cultures into the canon ones, centred where their elements are strong */
export function applyCanonCultures(): void {
  manaCache.clear();
  if (!seed.cultures.length) return;
  const { cells } = pack;
  const slots = living(pack.cultures).filter(culture => !culture.lock);
  const spacing = (options.map.graph.width + options.map.graph.height) / 2 / Math.max(slots.length, 1) / 2;
  const taken = new Set<Culture>();

  for (const canon of seed.cultures) {
    const marine = canon.type === "Marine";
    const slot = slots.find(c => !taken.has(c) && (c.type === "Marine") === marine) ?? slots.find(c => !taken.has(c));
    if (!slot) {
      report.push(`${canon.id}: no culture slot left (raise the cultures number)`);
      continue;
    }
    taken.add(slot);

    const elements = elementIndex(canon.elements);
    const bonus = nodeBonus(elements);
    const others = living(pack.cultures).filter(c => c !== slot && c.center !== undefined);
    const pool = cells.i.filter(i => cells.s[i] > 0 && cells.h[i] < 20 === marine && !cells.burg[i]);
    const score = (i: number) => (elements.length ? fit(i, elements) : cells.s[i] / 100) + bonus(i);
    const ranked = pool.sort((a, b) => score(b) - score(a));
    const far = (i: number) =>
      others.every(
        c => Math.hypot(cells.p[c.center!][0] - cells.p[i][0], cells.p[c.center!][1] - cells.p[i][1]) > spacing
      );
    const candidates: number[] = [];
    for (const i of ranked) if (candidates.length < CANDIDATES && far(i)) candidates.push(i);
    // a culture whose canon city is pinned to a node grows from that node
    const pinned = pairNode(pinnedOf(canon.id)?.node);
    const center = pinned
      ? nearestCell(pinned.x, pinned.y, i => cells.s[i] > 0 && cells.h[i] < 20 === marine && !cells.burg[i])
      : pick(candidates.length ? candidates : ranked.slice(0, CANDIDATES));
    if (center === undefined) {
      report.push(`${canon.id}: no cell for it`);
      continue;
    }

    if (slot.center !== undefined && cells.culture[slot.center] === slot.i) cells.culture[slot.center] = 0;
    cells.culture[center] = slot.i;
    slot.center = center;
    slot.name = canon.title;
    slot.code = canon.title.slice(0, 3);
    slot.artae = canon.id;
    if (canon.type && (CULTURE_TYPES as readonly string[]).includes(canon.type)) slot.type = canon.type as CultureType;
    else if (slot.type === "Marine" && !marine) slot.type = "Generic";
    const base = nameBase(canon);
    if (base !== undefined) slot.base = base;
    report.push(`culture ${canon.id} → culture:${slot.i} at cell ${center}`);
  }
}

/** The strongest node of an ordered pair, or else the strongest holding both elements */
function pairNode(names: string[] | undefined): SystemNode | undefined {
  const [a, b = a] = elementIndex(names ?? []);
  if (a === undefined) return undefined;
  const byLevel = (x: SystemNode, y: SystemNode) => y.node.level - x.node.level;
  const list = nodes();
  return (
    list.filter(({ node }) => node.primary === a && node.secondary === b).sort(byLevel)[0] ??
    list
      .filter(({ node }) => [node.primary, node.secondary].includes(a) && [node.primary, node.secondary].includes(b))
      .sort(byLevel)[0]
  );
}

/** The cell nearest a point, among those that pass `fits` (searched outwards from the point's cell) */
function nearestCell(x: number, y: number, fits: (cell: number) => boolean): number | undefined {
  const { cells } = pack;
  const start = Pack.findCell(x, y);
  if (start === undefined) return undefined;
  const seen = new Set([start]);
  let ring = [start];
  while (ring.length) {
    const found = ring.filter(fits);
    if (found.length)
      return found.sort(
        (p, q) => Math.hypot(cells.p[p][0] - x, cells.p[p][1] - y) - Math.hypot(cells.p[q][0] - x, cells.p[q][1] - y)
      )[0];
    const next: number[] = [];
    for (const cell of ring) for (const n of cells.c[cell]) if (!seen.has(n)) seen.add(n), next.push(n);
    ring = next;
  }
  return undefined;
}

/** Canon burgs of a culture pinned to a node */
const pinnedOf = (cultureId: string) => seed.burgs.find(b => b.culture === cultureId && b.node?.length);

const cultureOf = (canonId: string | undefined) =>
  canonId ? pack.cultures.find(c => c.artae === canonId && !c.removed) : undefined;

function move(burg: Burg, cell: number): void {
  const { cells } = pack;
  cells.burg[burg.cell] = 0;
  burg.cell = cell;
  [burg.x, burg.y] = cells.p[cell];
  burg.culture = cells.culture[cell];
  burg.feature = cells.f[cell];
  cells.burg[cell] = burg.i;
}

/** The best free cell of a culture's land (or sea, for marine peoples) for some elements */
function bestCell(culture: Culture, near: number[], keep?: Burg): number | undefined {
  const { cells } = pack;
  const marine = culture.type === "Marine";
  const bonus = nodeBonus(near);
  const pool = cells.i.filter(
    i =>
      cells.culture[i] === culture.i &&
      cells.s[i] > 0 &&
      cells.h[i] < 20 === marine &&
      (!cells.burg[i] || cells.burg[i] === keep?.i)
  );
  const score = (i: number) => (near.length ? fit(i, near) + bonus(i) : 0) + cells.s[i] / 1000;
  return pool.sort((a, b) => score(b) - score(a))[0];
}

/** After Burgs.generate: every canon culture that needs one gets a capital, and canon burgs are placed by name */
export function applyCanonBurgs(): void {
  if (!seed.burgs.length && !seed.states.length) return;
  const { cells } = pack;
  const burgs = living(pack.burgs);
  const claimed = new Set<Burg>();

  const capitalOf = (culture: Culture): Burg | undefined => {
    const own = burgs.find(b => b.capital && cells.culture[b.cell] === culture.i && !claimed.has(b));
    if (own) return own;
    // borrow the capital nearest to the culture's centre and move it into the culture's land
    const [cx, cy] = cells.p[culture.center ?? 0];
    const spare = burgs
      .filter(b => b.capital && !claimed.has(b) && !b.artae)
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
    const cell = spare && bestCell(culture, [], spare);
    if (!spare || cell === undefined) return undefined;
    move(spare, cell);
    return spare;
  };

  const needCapital = new Set([
    ...seed.states.map(s => s.culture),
    ...seed.burgs.filter(b => b.capital).map(b => b.culture)
  ]);
  for (const canonCulture of needCapital) {
    const culture = cultureOf(canonCulture);
    if (!culture) continue;
    const capital = capitalOf(culture);
    if (capital) claimed.add(capital);
    else report.push(`${canonCulture}: no capital could be placed`);
  }

  for (const canon of seed.burgs) {
    const culture = cultureOf(canon.culture);
    if (!culture) {
      report.push(`burg ${canon.id}: its culture ${canon.culture ?? "(none)"} is not on this map`);
      continue;
    }
    const near = elementIndex(canon.near);
    const burg = canon.capital
      ? burgs.find(b => b.capital && claimed.has(b) && cells.culture[b.cell] === culture.i && !b.artae)
      : (burgs.find(b => !b.capital && !b.artae && cells.culture[b.cell] === culture.i) ??
        burgs.filter(b => !b.capital && !b.artae)[0]);
    const node = pairNode(canon.node);
    const marine = culture.type === "Marine";
    let cell: number | undefined;
    if (burg && node) {
      // the cell nearest the node itself: whoever stands there makes way
      cell = nearestCell(
        node.x,
        node.y,
        i => cells.s[i] > 0 && cells.h[i] < 20 === marine && !burgs.some(b => b.cell === i && b.artae)
      );
      const occupant =
        cell !== undefined && cells.burg[cell] && cells.burg[cell] !== burg.i
          ? pack.burgs[cells.burg[cell]]
          : undefined;
      if (occupant) {
        const water = cells.h[occupant.cell] < 20;
        const away = nearestCell(
          occupant.x,
          occupant.y,
          i => !cells.burg[i] && cells.s[i] > 0 && cells.h[i] < 20 === water && i !== cell
        );
        if (away !== undefined) move(occupant, away);
        else cell = undefined;
      }
    } else if (burg) cell = bestCell(culture, near, burg);
    if (!burg || cell === undefined) {
      report.push(`burg ${canon.id}: no place for it`);
      continue;
    }
    move(burg, cell);
    if (node) {
      cells.culture[cell] = culture.i;
      burg.culture = culture.i;
      clearAround(node, burg, burgs);
    }
    burg.name = canon.title;
    burg.artae = canon.id;
    claimed.add(burg);
    report.push(`burg ${canon.id} → burg:${burg.i} at cell ${cell}${canon.capital ? " (capital)" : ""}`);
  }
}

/** A burg pinned to a node is the nearest town to it: any other burg as close or closer moves a little further out */
function clearAround(node: SystemNode, pinned: Burg, burgs: Burg[]): void {
  const { cells } = pack;
  const distance = (x: number, y: number) => Math.hypot(x - node.x, y - node.y);
  const reach = distance(pinned.x, pinned.y);
  for (const other of burgs) {
    if (other === pinned || other.removed || distance(other.x, other.y) > reach) continue;
    const water = cells.h[other.cell] < 20;
    const cell = nearestCell(
      other.x,
      other.y,
      i =>
        !cells.burg[i] &&
        cells.s[i] > 0 &&
        cells.h[i] < 20 === water &&
        distance(cells.p[i][0], cells.p[i][1]) > reach * 1.5 + 1
    );
    if (cell !== undefined) move(other, cell);
  }
}

/** Later steps may set a town down closer to a pinned node than its canon city: the two swap places */
function keepPinned(): void {
  const { cells } = pack;
  for (const canon of seed.burgs) {
    const node = pairNode(canon.node);
    const pinned = node && pack.burgs.find(b => b.i && !b.removed && b.artae === canon.id);
    if (!node || !pinned) continue;
    const distance = (b: Burg) => Math.hypot(b.x - node.x, b.y - node.y);
    const closer = pack.burgs
      .filter(b => b.i && !b.removed && b !== pinned && distance(b) < distance(pinned))
      .sort((a, b) => distance(a) - distance(b))[0];
    if (!closer) continue;
    const [cellA, xA, yA] = [pinned.cell, pinned.x, pinned.y];
    [pinned.cell, pinned.x, pinned.y] = [closer.cell, closer.x, closer.y];
    [closer.cell, closer.x, closer.y] = [cellA, xA, yA];
    cells.burg[pinned.cell] = pinned.i;
    cells.burg[closer.cell] = closer.i;
    if (pinned.capital) {
      const state = pack.states[pinned.state ?? 0];
      if (state?.capital === pinned.i) state.center = pinned.cell;
    }
    report.push(`burg ${canon.id}: swapped with ${closer.name} to stay nearest its node`);
  }
}

/** After the state forms: the realm of each canon state's culture takes the canon name */
export function applyCanonStates(): void {
  keepPinned();
  for (const canon of seed.states) {
    const culture = cultureOf(canon.culture);
    const ofCulture = (s: State) => !s.artae && pack.cells.culture[pack.burgs[s.capital].cell] === culture?.i;
    const realms = culture ? living(pack.states).filter(ofCulture) : [];
    const realm = realms.find(s => pack.burgs[s.capital]?.artae) ?? realms[0];
    if (!realm) {
      report.push(`state ${canon.id}: no realm of culture ${canon.culture ?? "(none)"}`);
      continue;
    }
    realm.name = canon.title;
    realm.fullName = canon.title;
    realm.artae = canon.id;
    report.push(`state ${canon.id} → state:${realm.i}`);
  }
}

/** The entity generated from a canon article on the map on screen, as a key like "burg:12" */
export function canonKey(canonId: string): string | undefined {
  const find = <T extends { i: number; removed?: boolean; artae?: string }>(list: T[], type: string) => {
    const item = list.find(entry => entry.i && !entry.removed && entry.artae === canonId);
    return item ? `${type}:${item.i}` : undefined;
  };
  return find(pack.states, "state") ?? find(pack.burgs, "burg") ?? find(pack.cultures, "culture");
}
