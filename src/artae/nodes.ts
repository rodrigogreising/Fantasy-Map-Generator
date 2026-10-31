// Artae: the setting's nodes, mana sources with an affinity for an ordered pair of elements. At least one per pair,
// placed where the geography expresses the pair best, levelled within the profile's range by how strong that is. Nodes are their own collection, `pack.artaeNodes`,
// saved as the map file's last record; the mana field is derived from them and drawn by the "elements" layer, the
// nodes themselves by the "nodes" layer
import { interpolateRgb } from "d3";
import { type Affinity, computeAffinity, ELEMENTS, elementLabel } from "@/artae/elements";
import { profile } from "@/artae/profile";
import { ensureEl } from "@/utils/node-utils";
import { getIsolines } from "@/utils/path-utils";

export const NODE_KEY = "nodo"; // canon anchors name a node as "nodo:12"

export interface NodeData {
  primary: number; // element index
  secondary: number;
  poles: [number, number];
  level: number;
  fit: number; // 0..1, how well the cell expresses the pair
  gridCell: number; // the elemental layer works on the grid, which keeps the deep ocean
}

export interface SystemNode {
  i: number;
  x: number;
  y: number;
  name: string;
  lock?: boolean; // confirmed by the author: kept when nodes are regenerated
  note?: string;
  node: NodeData;
}

declare module "@/types/packed-graph" {
  interface PackedGraph {
    artaeNodes?: SystemNode[];
  }
}

export const nodes = (): SystemNode[] => pack.artaeNodes ?? [];
export const findNode = (i: number) => nodes().find(node => node.i === i);

/** The map file record: the last line, tagged so upstream records added later never collide with it */
const RECORD_TAG = "ARTAE_NODES:";
export const serializeNodes = () => RECORD_TAG + JSON.stringify(nodes());
export function restoreNodes(lines: string[]): void {
  const record = lines.findLast(line => line.startsWith(RECORD_TAG));
  pack.artaeNodes = record ? JSON.parse(record.slice(RECORD_TAG.length)) : [];
}

let affinityCache: { map: unknown; elements: unknown; affinity: Affinity } | undefined;
export function affinity(): Affinity {
  if (affinityCache?.map !== grid.cells || affinityCache.elements !== ELEMENTS)
    affinityCache = { map: grid.cells, elements: ELEMENTS, affinity: computeAffinity() }; // a new profile, new elements
  return affinityCache.affinity;
}

/** Planet-surface distance helper: x shrinks with latitude, so polar cells are not over-counted */
function cosAt(y: number): number {
  const { latN, latS } = options.map.geography.coordinates;
  const lat = latN - (y / options.map.graph.height) * (latN - latS);
  return Math.max(0.05, Math.cos((lat * Math.PI) / 180));
}

function makeDistance() {
  return (a: number[], b: number[]) => {
    const dx = (a[0] - b[0]) * cosAt((a[1] + b[1]) / 2);
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  };
}

function surfaceArea(): number {
  const distance = makeDistance();
  let area = 0;
  const cellArea = (options.map.graph.width * options.map.graph.height) / grid.cells.i.length;
  for (const p of grid.points) area += cellArea * (distance(p, [p[0] + 1, p[1]]) || 1);
  return area;
}

interface Candidate {
  pair: number;
  cell: number;
  score: number;
}

/** Best cells for an ordered pair: the primary weighs double */
function topCells(value: Float32Array[], a: number, b: number, count: number): Candidate[] {
  const n = value[0].length;
  const pair = a * ELEMENTS.length + b;
  const best: Candidate[] = [];
  let floor = -1;
  for (let cell = 0; cell < n; cell++) {
    const score = (2 * value[a][cell] + value[b][cell]) / 3;
    if (best.length >= count && score <= floor) continue;
    best.push({ pair, cell, score });
    if (best.length > count * 2) {
      best.sort((x, y) => y.score - x.score).length = count;
      floor = best[count - 1].score;
    }
  }
  return best.sort((x, y) => y.score - x.score).slice(0, count);
}

/** Replace every unlocked node with a fresh set; locked nodes stay and keep their pairs. `extra` adds that many more
 * nodes for the strongest pairs */
export function generateNodes({ extra = 0 } = {}): SystemNode[] {
  const { value, pole } = affinity();
  const count = ELEMENTS.length;
  const total = count * count + extra;
  const distance = makeDistance();
  const spacing = 0.75 * Math.sqrt(surfaceArea() / total);
  const placed: { cell: number; pair: number; score: number }[] = [];
  const taken = new Set<number>();
  const remaining = new Set(Array.from({ length: count * count }, (_, pair) => pair));
  const kept = nodes().filter(node => node.lock);

  const buckets = new Map<string, number[]>(); // spatial hash of placed cells, by spacing-sized buckets
  const bucket = (p: number[], size: number) => `${Math.floor(p[0] / size)},${Math.floor(p[1] / size)}`;
  const farEnough = (cell: number, radius: number, size: number) => {
    const p = grid.points[cell];
    const [bx, by] = [Math.floor(p[0] / size), Math.floor(p[1] / size)];
    const reach = Math.min(40, Math.ceil(radius / (size * cosAt(p[1]))));
    for (let dx = -reach; dx <= reach; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? [])
          if (distance(p, grid.points[other]) < radius) return false;
    return true;
  };
  for (const { node } of kept) {
    remaining.delete(node.primary * count + node.secondary);
    taken.add(node.gridCell);
    const key = bucket(grid.points[node.gridCell], Math.max(spacing, 1));
    buckets.set(key, [...(buckets.get(key) ?? []), node.gridCell]);
  }

  for (const factor of [1, 0.8, 0.6, 0.45, 0.3, 0.15, 0]) {
    if (!remaining.size) break;
    const radius = spacing * factor;
    const size = Math.max(spacing, 1);
    const depth = factor > 0.5 ? 40 : 400;
    const candidates = [...remaining].flatMap(pair => topCells(value, Math.floor(pair / count), pair % count, depth));
    candidates.sort((x, y) => y.score - x.score);
    for (const { pair, cell, score } of candidates) {
      if (!remaining.has(pair) || taken.has(cell)) continue;
      if (radius && !farEnough(cell, radius, size)) continue;
      placed.push({ cell, pair, score });
      taken.add(cell);
      remaining.delete(pair);
      const key = bucket(grid.points[cell], size);
      buckets.set(key, [...(buckets.get(key) ?? []), cell]);
    }
  }

  if (extra > 0) {
    const pairs = Array.from({ length: count * count }, (_, pair) => pair);
    const candidates = pairs.flatMap(pair => topCells(value, Math.floor(pair / count), pair % count, 20));
    candidates.sort((x, y) => y.score - x.score);
    const size = Math.max(spacing, 1);
    let added = 0;
    for (const { pair, cell, score } of candidates) {
      if (added >= extra) break;
      if (taken.has(cell) || !farEnough(cell, spacing, size)) continue;
      placed.push({ cell, pair, score });
      taken.add(cell);
      added++;
      const key = bucket(grid.points[cell], size);
      buckets.set(key, [...(buckets.get(key) ?? []), cell]);
    }
  }

  // the fit is the node's rank among all nodes, so levels spread over the whole range whatever the raw scores
  const order = placed.map((_, k) => k).sort((a, b) => placed[a].score - placed[b].score);
  const fits = new Float32Array(placed.length);
  for (const [position, k] of order.entries()) fits[k] = placed.length > 1 ? position / (placed.length - 1) : 1;

  let next = Math.max(-1, ...kept.map(node => node.i)) + 1;
  const { levels } = profile();
  const made = placed.map(({ cell, pair }, k): SystemNode => {
    const primary = Math.floor(pair / count);
    const secondary = pair % count;
    const fit = fits[k];
    const node: NodeData = {
      primary,
      secondary,
      poles: [pole[primary][cell], pole[secondary][cell]],
      level: Math.round(levels[0] + (levels[1] - levels[0]) * fit ** 2),
      fit: Math.round(fit * 1000) / 1000,
      gridCell: cell
    };
    const [x, y] = grid.points[cell];
    return { i: next++, x, y, name: nodeName(node), node };
  });
  pack.artaeNodes = [...kept, ...made];
  return pack.artaeNodes;
}

export function nodeName({ primary, secondary, poles }: NodeData): string {
  const a = elementLabel(primary, poles[0]);
  const { node, nodePair } = profile().texts;
  return primary === secondary
    ? node.replace("{a}", a)
    : nodePair.replace("{a}", a).replace("{b}", elementLabel(secondary, poles[1]));
}

/** Each cell's mana, the way auras share space: a node's pressure falls with the inverse square of the straight-line
 * distance through the sphere, and a cell belongs to the node whose pressure is highest there (a weighted Voronoi
 * cell). `level` is that pressure in levels: the node's own level at its core, a quarter at double the distance */
export interface ManaField {
  owner: Int32Array;
  level: Float32Array;
}

const CORE = 0.25; // core radius, as a share of the typical spacing between nodes: inside it the level barely falls

/** Unit vectors on the sphere for map points */
function toSphere(x: number, y: number): [number, number, number] {
  const { latN, latS, lonW, lonE } = options.map.geography.coordinates;
  const { width, height } = options.map.graph;
  const lat = ((latN - (y / height) * (latN - latS)) * Math.PI) / 180;
  const lon = ((lonW + (x / width) * (lonE - lonW)) * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Levels add as powers of the profile's base: with base 2 each level is twice the mana of the one below, so two
 * sources of level 10 make a level 11 spot. A node's mana counts at a spot from level 1 on; fainter tails from across
 * the planet don't add up */
const MIN_LEVEL = 1;
const energy = (level: number) => (level >= MIN_LEVEL ? profile().levelBase ** level : 0);
const logBase = (total: number, base: number) => (base === 2 ? Math.log2(total) : Math.log(total) / Math.log(base));
const toLevel = (total: number) => (total > 1 ? logBase(total, profile().levelBase) : 0);

export function manaField(): ManaField {
  const list = nodes();
  const n = grid.cells.i.length;
  const owner = new Int32Array(n).fill(-1);
  const level = new Float32Array(n);
  if (!list.length) return { owner, level };

  const core = CORE * Math.sqrt((4 * Math.PI) / list.length);
  const core2 = core * core;
  const sources = list.map(({ x, y, node }) => [...toSphere(x, y), node.level]);
  for (let cell = 0; cell < n; cell++) {
    const [cx, cy, cz] = toSphere(grid.points[cell][0], grid.points[cell][1]);
    let best = -1;
    let strongest = 0;
    let total = 0;
    for (let k = 0; k < sources.length; k++) {
      const [sx, sy, sz, strength] = sources[k];
      const d2 = (cx - sx) ** 2 + (cy - sy) ** 2 + (cz - sz) ** 2;
      const p = (strength * core2) / (core2 + d2);
      total += energy(p);
      if (p > strongest) {
        strongest = p;
        best = k;
      }
    }
    owner[cell] = best;
    level[cell] = toLevel(total);
  }
  return { owner, level };
}

let fieldCache: { markers: unknown; signature: string; field: ManaField } | undefined;
export function cachedField(): ManaField {
  const signature = nodes()
    .map(m => `${m.i}:${m.node.gridCell}:${m.node.level}`)
    .join(",");
  if (fieldCache?.markers !== grid.cells || fieldCache.signature !== signature)
    fieldCache = { markers: grid.cells, signature, field: manaField() };
  return fieldCache.field;
}

/** A node's mana colour: its primary element, tinted a third of the way to its secondary */
export const manaColor = ({ primary, secondary }: NodeData) =>
  interpolateRgb(ELEMENTS[primary].color, ELEMENTS[secondary].color)(1 / 3);

/** Shading band of a level: one per doubling, since the field falls as a power of distance */
const BAND_STEP = 3; // a visible step in the shading every 3 levels
const band = (level: number) => Math.min(BAND_OPACITY.length - 1, Math.floor(level / BAND_STEP));
/** Opacity per band (0-3, 3-6, 6-9, 9-12…): faint but distinct steps below 9, clearly visible from 9-12 on */
const BAND_OPACITY = [0.03, 0.13, 0.23, 0.42, 0.55, 0.66, 0.75, 0.82, 0.88, 0.92, 0.95];

/** Each cell in its node's mana colour, more opaque the higher its level, with region outlines */
export function drawMana(): void {
  const list = nodes();
  const group = ensureEl("elements");
  if (!list.length) {
    group.innerHTML = "";
    return;
  }
  const { owner, level } = cachedField();
  const graph = grid as unknown as Parameters<typeof getIsolines>[0];
  const bands = BAND_OPACITY.length;
  const shaded = getIsolines(graph, cell => (owner[cell] < 0 ? null : owner[cell] * bands + band(level[cell])), {
    fill: true
  });
  const outlines = getIsolines(graph, cell => (owner[cell] < 0 ? null : owner[cell]), { fill: true });
  const fills = Object.entries(shaded).map(([key, { fill }]) => {
    const node = list[Math.floor(+key / bands)].node;
    const opacity = BAND_OPACITY[+key % bands];
    const color = interpolateRgb("#9a9a9a", manaColor(node))(0.25 + 0.75 * Math.min(1, opacity / 0.75)); // low levels greyed
    return `<path d="${fill}" fill="${color}" fill-opacity="${opacity}" stroke="none" />`;
  });
  const borders = Object.values(outlines).map(({ fill }) => `<path d="${fill}" fill="none" />`);
  group.innerHTML = fills.join("") + borders.join("");
}

/** What hovering a node shows: its name, level and both elements with their families */
export function nodeLabel(node: NodeData, name: string): string {
  const family = (e: number) => ELEMENTS[e].family;
  const families =
    node.primary === node.secondary ? family(node.primary) : `${family(node.primary)} / ${family(node.secondary)}`;
  return `${name} · nivel ${node.level} · ${families}`;
}

/** Each element's level at a grid cell: the mana every node brings of it there, added as powers of two like the total
 * (2/3 of a node's mana goes to its primary element, 1/3 to its secondary). No element exceeds the spot's total.
 * Indexed by element */
export function elementLevels(gridCell: number): number[] {
  const { sources, core2 } = nodeSources();
  const totals = new Array<number>(ELEMENTS.length).fill(0);
  if (!sources.length) return totals;
  const [cx, cy, cz] = toSphere(grid.points[gridCell][0], grid.points[gridCell][1]);
  for (const { sx, sy, sz, level, primary, secondary } of sources) {
    const e = energy((level * core2) / (core2 + (cx - sx) ** 2 + (cy - sy) ** 2 + (cz - sz) ** 2));
    if (!e) continue;
    totals[primary] += primary === secondary ? e : (e * 2) / 3;
    if (primary !== secondary) totals[secondary] += e / 3;
  }
  return totals.map(toLevel);
}

/** Nodes as points on the unit sphere, cached while the nodes and the map stay the same */
let sourceCache: { list: unknown; map: unknown; sources: Source[]; core2: number } | undefined;
interface Source {
  sx: number;
  sy: number;
  sz: number;
  level: number;
  primary: number;
  secondary: number;
}
function nodeSources(): { sources: Source[]; core2: number } {
  const list = nodes();
  // regenerating nodes makes a new list, so the list itself is the cache key
  if (sourceCache && sourceCache.list === pack.artaeNodes && sourceCache.map === grid.cells) return sourceCache;
  const core = CORE * Math.sqrt((4 * Math.PI) / Math.max(1, list.length));
  const sources = list.map(({ x, y, node }) => {
    const [sx, sy, sz] = toSphere(x, y);
    return { sx, sy, sz, level: node.level, primary: node.primary, secondary: node.secondary };
  });
  sourceCache = { list: pack.artaeNodes, map: grid.cells, sources, core2: core * core };
  return sourceCache;
}

/** The mana mix at a grid cell: each element's share of the spot's mana, strongest first */
export function localMix(gridCell: number): { element: number; share: number }[] {
  const amounts = elementLevels(gridCell).map(level => (level > 0 ? profile().levelBase ** level : 0));
  const total = amounts.reduce((sum, value) => sum + value, 0) || 1;
  return amounts.map((value, element) => ({ element, share: value / total })).sort((a, b) => b.share - a.share);
}

/** What hovering the mana layer shows for a grid cell: the level there, the local mix, and the dominant node */
export function manaTip(gridCell: number): string {
  const { owner, level } = cachedField();
  const node = nodes()[owner[gridCell]];
  if (!node) return "";
  const mix = localMix(gridCell)
    .slice(0, 3)
    .map(({ element, share }) => `${ELEMENTS[element].name} ${Math.round(share * 100)}%`)
    .join(", ");
  return `Mana nivel ${level[gridCell].toFixed(1)} · ${mix} (domina: ${node.name}, nivel ${node.node.level})`;
}

/** Each node as a diamond: fill its primary element, outline its secondary, size by level */
export function drawNodes(): void {
  const group = ensureEl("artaeNodes");
  group.parentNode?.append(group); // above every other layer, so a node is always what the pointer hits
  group.innerHTML = nodes()
    .map(({ i, x, y, name, lock, node }) => {
      const r = 1.5 + node.level / 6;
      const points = `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
      const fill = ELEMENTS[node.primary].color;
      const stroke = ELEMENTS[node.secondary].color;
      const label = nodeLabel(node, name).replace(/"/g, "&quot;");
      return `<polygon id="artaeNode${i}" points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${r / 3}" data-label="${label}"${lock ? ' class="locked"' : ""} />`;
    })
    .join("");
}
