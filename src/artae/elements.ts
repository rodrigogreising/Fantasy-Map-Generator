// Artae: the setting's base elements and how strongly each map cell expresses them. The element set comes from the
// world profile (src/artae/profile.ts): each element has a rule, an expression over the per-cell geographic signals
// below. Affinities are rank-normalised over the cells, so each element has its strongholds somewhere on the planet.
// The set can hold any number of elements: nodes cover every ordered pair
import { compile } from "@/artae/expressions";
import { onProfile, type Profile } from "@/artae/profile";

/** How strongly a grid cell expresses an element: [magnitude, pole], the pole 1-based into `poles` (0 or omitted
 * when the element has none). Magnitudes need no scale: they are ranked over the planet */
type Rule = (s: Signals, i: number) => [number, number?];

export interface Element {
  name: string;
  family: string; // a free grouping, shown on hover
  color: string;
  poles?: string[]; // the states or ends of the axis
  rule: Rule;
  gender?: "m" | "f";
  article?: "m" | "f";
  adjective?: [string, string];
}

/** The per-cell fields a profile rule may read, each 0..1 */
export const SIGNAL_NAMES = [
  "water",
  "elev",
  "depth",
  "hot",
  "cold",
  "wet",
  "life",
  "barren",
  "flux",
  "slope",
  "coast",
  "open",
  "hetero",
  "climateShift",
  "volcano",
  "prominence",
  "sun",
  "polar",
  "junction",
  "islet",
  "glacier",
  "wetland",
  "desert",
  "fog",
  "noise",
  "magneticNorth",
  "magneticSouth"
] as const;

/** Compile the profile's elements; with poles, the strongest pole's rule wins in each cell */
function build(profile: Profile): Element[] {
  return profile.elements.map(({ name, family, color, rule, poles, gender, article, adjective }) => {
    const base = { name, family, color, gender, article, adjective };
    if (poles?.length) {
      const rules = poles.map(pole => compile(pole.rule, SIGNAL_NAMES));
      return {
        ...base,
        poles: poles.map(pole => pole.label),
        rule: (s, i) => {
          let best = Number.NEGATIVE_INFINITY;
          let strongest = 0;
          for (let k = 0; k < rules.length; k++) {
            const value = rules[k](s as unknown as Record<string, ArrayLike<number>>, i);
            if (value > best) {
              best = value;
              strongest = k;
            }
          }
          return [best, strongest + 1];
        }
      };
    }
    const compiled = compile(rule ?? "0", SIGNAL_NAMES);
    return { ...base, rule: (s, i) => [compiled(s as unknown as Record<string, ArrayLike<number>>, i)] };
  });
}

/** The current profile's elements; replaced when the profile changes (a live binding for every importer) */
export let ELEMENTS: Element[] = [];
onProfile(profile => {
  ELEMENTS = build(profile);
});

export interface Affinity {
  value: Float32Array[]; // by element index, then grid cell: 0..1 rank
  pole: Int8Array[]; // by element index, then grid cell: 1-based index into the element's poles, 0 non-polar
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function normalise(values: Float32Array): Float32Array {
  let max = 0;
  for (const value of values) if (value > max) max = value;
  if (max > 0) for (let i = 0; i < values.length; i++) values[i] /= max;
  return values;
}

/** Percentile of each cell's value; ties share a rank */
function rank(values: Float32Array): Float32Array {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b]);
  const ranked = new Float32Array(values.length);
  const last = Math.max(1, order.length - 1);
  for (let k = 0; k < order.length; ) {
    let end = k;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[k]]) end++;
    const r = (k + end) / 2 / last;
    for (let j = k; j <= end; j++) ranked[order[j]] = r;
    k = end + 1;
  }
  return ranked;
}

/** Deterministic noise per cell for the given seed */
const noise = (i: number, seed: number) => {
  let x = (i * 374761393 + seed * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
};

/** Distance in graph steps from any source cell, capped */
function steps(sources: number[], neighbors: number[][], cap: number): Float32Array {
  const distance = new Float32Array(neighbors.length).fill(cap);
  const queue = [...sources];
  for (const cell of sources) distance[cell] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (distance[cell] >= cap) continue;
    for (const next of neighbors[cell])
      if (distance[next] > distance[cell] + 1) {
        distance[next] = distance[cell] + 1;
        queue.push(next);
      }
  }
  return distance;
}

/** Angular distance in degrees between two points on the sphere */
function arc(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(lat1 * rad) * Math.sin(lat2 * rad) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon1 - lon2) * rad);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / rad;
}

/** The planet's magnetic poles: near the geographic ones, offset by the seed */
export function magneticPoles(seed = Number.parseInt(String(options.map.seed), 10) || 1) {
  const at = (k: number, sign: number): [number, number] => [
    sign * (72 + noise(k, seed) * 14),
    noise(k + 1, seed) * 360 - 180
  ];
  return { north: at(1, 1), south: at(3, -1) };
}

const HABITABILITY_FALLBACK = [0, 4, 10, 22, 30, 50, 100, 80, 90, 12, 4, 0, 12];

/** Pack data the grid lacks, carried over to the grid cells the packed cells came from; deep ocean keeps the defaults */
function fromPack(n: number) {
  const biome = new Uint8Array(n);
  const flux = new Float32Array(n);
  const confluence = new Uint8Array(n);
  const islet = new Uint8Array(n);
  const { cells, features } = pack;
  for (let i = 0; i < cells.i.length; i++) {
    const g = cells.g[i];
    if (cells.h[i] >= 20 || !biome[g]) biome[g] = cells.biome[i];
    flux[g] = Math.max(flux[g], cells.h[i] >= 20 ? cells.fl[i] : 0);
    if (cells.conf[i]) confluence[g] = 1;
    const feature = features[cells.f[i]];
    if (cells.h[i] >= 20 && feature && typeof feature === "object" && feature.cells < 60) islet[g] = 1;
  }
  return { biome, flux, confluence, islet };
}

/** The geographic signals every element is built from, one value per grid cell: the grid covers the whole planet
 * evenly, deep ocean included, which the packed graph drops */
function signals() {
  const { cells, points } = grid;
  const n = cells.i.length;
  const { biomes } = pack;
  const { latN, latS, lonW, lonE } = options.map.geography.coordinates;
  const { width, height } = options.map.graph;
  const seed = Number.parseInt(String(options.map.seed), 10) || 1;
  const carried = fromPack(n);
  const biomeName = (i: number) => biomes[carried.biome[i]]?.name ?? "";
  const volcanic = pack.markers
    .filter(m => m.type === "volcanoes" || m.type === "hot-springs")
    .map(m => pack.cells.g[m.cell]);
  const volcanoSteps = steps(volcanic, cells.c, 12);

  const s = {
    water: new Uint8Array(n),
    elev: new Float32Array(n),
    depth: new Float32Array(n),
    hot: new Float32Array(n),
    cold: new Float32Array(n),
    wet: new Float32Array(n),
    life: new Float32Array(n),
    barren: new Float32Array(n),
    flux: new Float32Array(n),
    slope: new Float32Array(n),
    coast: new Float32Array(n),
    open: new Float32Array(n),
    hetero: new Float32Array(n),
    climateShift: new Float32Array(n),
    volcano: new Float32Array(n),
    prominence: new Float32Array(n),
    sun: new Float32Array(n),
    polar: new Float32Array(n),
    junction: new Float32Array(n),
    islet: new Float32Array(n),
    glacier: new Float32Array(n),
    wetland: new Float32Array(n),
    desert: new Float32Array(n),
    fog: new Float32Array(n),
    noise: new Float32Array(n),
    magneticNorth: new Float32Array(n),
    magneticSouth: new Float32Array(n)
  };
  const magnetic = magneticPoles(seed);

  let maxDistance = 1;
  for (let i = 0; i < n; i++) maxDistance = Math.max(maxDistance, Math.abs(cells.t[i]));

  for (let i = 0; i < n; i++) {
    const h = cells.h[i];
    const water = h < 20;
    const temp = cells.temp[i];
    const prec = cells.prec[i];
    const lat = latN - (points[i][1] / height) * (latN - latS);
    const name = biomeName(i);
    const neighbors = cells.c[i];

    s.water[i] = water ? 1 : 0;
    s.elev[i] = water ? 0 : (h - 20) / 80;
    s.depth[i] = water ? (20 - h) / 20 : 0;
    s.hot[i] = clamp((temp - 12) / 22);
    s.cold[i] = clamp((6 - temp) / 30);
    s.wet[i] = clamp(prec / 60);
    const biome = carried.biome[i];
    const habitability = biomes[biome]?.habitability ?? HABITABILITY_FALLBACK[biome] ?? 0;
    s.life[i] = water
      ? clamp((Math.abs(cells.t[i]) <= 2 ? 0.7 : 0.25) * (0.5 + s.hot[i]) * (1 - s.depth[i] * 0.6))
      : habitability / 100;
    s.barren[i] = water ? s.depth[i] * 0.8 : 1 - habitability / 100;
    s.flux[i] = Math.log1p(carried.flux[i]);
    s.coast[i] = Math.abs(cells.t[i]) === 1 ? 1 : 0;
    s.open[i] = Math.abs(cells.t[i]) / maxDistance;
    s.volcano[i] = Math.exp(-volcanoSteps[i] / 3);
    s.sun[i] = Math.cos((lat * Math.PI) / 180) * (1 - s.wet[i] * 0.4);
    s.polar[i] = clamp((Math.abs(lat) - 55) / 30);
    s.glacier[i] = name === "Glacier" ? 1 : 0;
    s.wetland[i] = name === "Wetland" ? 1 : 0;
    s.desert[i] = name === "Hot desert" || name === "Cold desert" ? 1 : 0;
    s.fog[i] = clamp(s.wet[i] * (1 - s.hot[i]) * (s.coast[i] || s.elev[i] > 0.3 ? 1 : 0.4));
    s.noise[i] = noise(i, seed);
    const lon = lonW + (points[i][0] / width) * (lonE - lonW);
    s.magneticNorth[i] = Math.exp(-arc(lat, lon, ...magnetic.north) / 12);
    s.magneticSouth[i] = Math.exp(-arc(lat, lon, ...magnetic.south) / 12);

    let slope = 0;
    let sum = 0;
    const kinds = new Set([biome]);
    const waters = new Set<number>();
    let tempSpread = 0;
    for (const next of neighbors) {
      slope = Math.max(slope, Math.abs(h - cells.h[next]));
      sum += cells.h[next];
      kinds.add(carried.biome[next]);
      if (cells.h[next] < 20) waters.add(cells.f[next]);
      tempSpread = Math.max(tempSpread, Math.abs(temp - cells.temp[next]));
    }
    s.slope[i] = clamp(slope / 15);
    s.prominence[i] = water ? 0 : clamp((h - sum / Math.max(1, neighbors.length)) / 10);
    s.hetero[i] = clamp((kinds.size - 1) / 3);
    s.climateShift[i] = clamp(tempSpread / 6);
    s.junction[i] = clamp((carried.confluence[i] ? 0.6 : 0) + (waters.size > 1 ? 0.8 : 0));
    s.islet[i] = carried.islet[i];
  }
  normalise(s.flux);
  return s;
}

type Signals = ReturnType<typeof signals>;

/** Every element's affinity for every grid cell of the map on screen */
export function computeAffinity(): Affinity {
  return affinityOf(ELEMENTS);
}

function affinityOf(elements: readonly Element[]): Affinity {
  const s = signals();
  const n = grid.cells.i.length;
  const value: Float32Array[] = [];
  const pole: Int8Array[] = [];
  for (const element of elements) {
    const raw = new Float32Array(n);
    const sign = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const [magnitude, direction = 0] = element.rule(s, i);
      raw[i] = magnitude + s.noise[(i * 7 + 13) % n] * 0.02; // breaks ties so ranks stay spread
      sign[i] = direction;
    }
    value.push(rank(raw));
    pole.push(sign);
  }
  return { value, pole };
}

/** "Element (pole)" for elements with poles, the bare name otherwise */
export function elementLabel(index: number, pole: number): string {
  const { name, poles } = ELEMENTS[index];
  if (!poles || !pole) return name;
  return `${name} (${poles[pole - 1]})`;
}
