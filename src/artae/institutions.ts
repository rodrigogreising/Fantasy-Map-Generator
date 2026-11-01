// Artae: institutions, groups that master an ordered pair of the setting's elements. Every pair has one archetype per
// kind, rolled from the world profile's kinds with a tint (one of the profile's pantheon tints, never chosen by
// geography). A canon example for a pair and kind replaces the rolled archetype. Towns host the institutions whose
// pairs are strong where they stand

import { ELEMENTS } from "@/artae/elements";
import { loreMap } from "@/artae/lore";
import * as Nodes from "@/artae/nodes";
import { onProfile, type Profile, type ProfileKind, profile } from "@/artae/profile";

export type Tint = string;
type Kind = ProfileKind;

/** The profile's tints by name, and its institution kinds; replaced when the profile changes */
export let TINTS: Record<Tint, { strategy: string; color: string }> = {};
export let KINDS: Kind[] = [];
let TINT_NAMES: Tint[] = [];
onProfile((next: Profile) => {
  TINTS = Object.fromEntries(next.tints.map(({ name, strategy, color }) => [name, { strategy, color }]));
  TINT_NAMES = next.tints.map(tint => tint.name);
  KINDS = next.kinds;
});

/** The kind a canon example names, by id or alias */
const kindOf = (name?: string) =>
  KINDS.find(kind => kind.id === name || kind.aliases?.includes(name?.toLowerCase() ?? "")) ?? undefined;

/** The pair as phrases with their article, from the profile's grammar: {el}, {de}, {al} in the kinds' texts */
function pairPhrase(primary: number, secondary: number) {
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

const fill = (template: string, phrase: ReturnType<typeof pairPhrase>) =>
  template.replace("{de}", phrase.de).replace("{el}", phrase.el).replace("{al}", phrase.al);

/** Stable hash of numbers and strings: same inputs, same roll, every session */
function hash(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const char of parts.join("|")) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Archetype {
  primary: number;
  secondary: number;
  kind: string;
  kindLabel: string;
  tint: Tint;
  name: string;
  purpose: string;
  canon?: string; // canon article id when a concrete example replaces the rolled archetype
}

interface CanonInstitution {
  id: string;
  title: string;
  summary?: string;
  elements: string[];
  kind?: string;
  tint?: string;
}

let canonCache: { map: string; list: CanonInstitution[] } | undefined;
let canonLoading: string | undefined;

/** Concrete institutions the canon defines for the repo map on screen; loaded once per map, empty until then */
function canonInstitutions(): CanonInstitution[] {
  const map = loreMap();
  if (!map) return [];
  if (canonCache?.map === map) return canonCache.list;
  if (canonLoading !== map) {
    canonLoading = map;
    fetch(`/artae/api/seed/${map}`)
      .then(response => (response.ok ? response.json() : {}))
      .then((seed: { institutions?: CanonInstitution[] }) => {
        canonCache = { map, list: Array.isArray(seed.institutions) ? seed.institutions : [] };
      })
      .catch(() => {
        canonCache = { map, list: [] };
      });
  }
  return [];
}

/** Load the canon examples for the map on screen before showing institutions */
export async function loadCanonInstitutions(): Promise<void> {
  canonInstitutions();
  const map = loreMap();
  for (let tries = 0; map && canonCache?.map !== map && tries < 20; tries++) await new Promise(r => setTimeout(r, 50));
}

const elementIndex = (name: string) => ELEMENTS.findIndex(element => element.name === name);

/** The archetypes of an ordered pair, one per kind; canon examples replace the rolled ones */
export function archetypes(primary: number, secondary: number): Archetype[] {
  const phrase = pairPhrase(primary, secondary);
  const canon = canonInstitutions().filter(
    item =>
      elementIndex(item.elements?.[0]) === primary &&
      elementIndex(item.elements?.[1] ?? item.elements?.[0]) === secondary
  );
  return KINDS.map(kind => {
    const example = canon.find(item => (item.kind ? kindOf(item.kind)?.id : kind.id) === kind.id);
    const tint = (
      example?.tint && example.tint in TINTS
        ? example.tint
        : TINT_NAMES[hash(primary, secondary, kind.id) % TINT_NAMES.length]
    ) as Tint;
    if (example)
      return {
        primary,
        secondary,
        kind: kind.id,
        kindLabel: kind.label,
        tint,
        name: example.title,
        purpose: example.summary ?? "",
        canon: example.id
      };
    const name = fill(kind.names[hash(primary, secondary, kind.id, "name") % kind.names.length], phrase);
    return {
      primary,
      secondary,
      kind: kind.id,
      kindLabel: kind.label,
      tint,
      name,
      purpose: fill(kind.purpose[tint], phrase)
    };
  });
}

/** Archetypes of a pair by element names, as `artae.institutionArchetypes("Fire", "Earth")` */
export function archetypesByName(primary: string, secondary: string = primary): Archetype[] {
  const [a, b] = [elementIndex(primary), elementIndex(secondary)];
  if (a < 0 || b < 0) throw new Error(`Unknown element: ${a < 0 ? primary : secondary}`);
  return archetypes(a, b);
}

/** Each element's local level at a grid cell, as auras add up (see nodes.ts) */
export const elementLevels = (gridCell: number): number[] => Nodes.elementLevels(gridCell);

export interface Presence extends Archetype {
  strength: number; // how strong the pair is in the town
}

const PAIRS_BASE = 2; // pairs every town hosts; capitals and big towns host more
const LINEAGES_CAPITAL = 3; // most noble houses a capital hosts
const LINEAGES_TOWN = 1;
const PURE_WEIGHT = 0.6; // a pure pair (Luz + Luz) needs a clearly dominant element to beat the local mixes

/** The institutions present in a town: its strongest local pairs, and for each the kinds that have a seat there */
export function townInstitutions(burgId: number): { levels: number[]; institutions: Presence[] } {
  const burg = pack.burgs[burgId];
  if (!burg?.i || burg.removed || !Nodes.nodes().length) return { levels: [], institutions: [] };
  const levels = elementLevels(pack.cells.g[burg.cell]);
  const size = (burg.capital ? 2 : 0) + Math.min(3, Math.floor(Math.log2(1 + (burg.population ?? 0))));
  const pairs: { primary: number; secondary: number; strength: number }[] = [];
  for (let a = 0; a < levels.length; a++)
    for (let b = 0; b < levels.length; b++) {
      const strength =
        a === b
          ? levels[a] * PURE_WEIGHT
          : ((2 * levels[a] + levels[b]) / 3) *
            Math.sqrt(Math.min(levels[a], levels[b]) / (Math.max(levels[a], levels[b]) || 1));
      if (strength > 0) pairs.push({ primary: a, secondary: b, strength });
    }
  pairs.sort((x, y) => y.strength - x.strength);
  const institutions = pairs.slice(0, PAIRS_BASE + size).flatMap(({ primary, secondary, strength }, rank) => {
    const seats = Math.max(1, Math.min(KINDS.length, 1 + Math.floor(size / 2) - (rank > 2 ? 1 : 0)));
    const list = archetypes(primary, secondary);
    const large = burg.capital || size >= 3;
    const hosts = (k: number) => {
      const rarity = KINDS[k].rarity;
      return rarity === undefined || large || hash(burgId, primary, secondary, KINDS[k].id) % 1000 < rarity * 1000;
    };
    const order = list
      .map((_, k) => k)
      .filter(hosts)
      .sort((x, y) => hash(burgId, primary, secondary, x) - hash(burgId, primary, secondary, y));
    // lineages rule capitals and large towns: they come first there
    if (large) order.sort((x, y) => Number(KINDS[y].rarity !== undefined) - Number(KINDS[x].rarity !== undefined));
    const canonFirst = list.map((item, k) => (item.canon ? k : -1)).filter(k => k >= 0);
    const chosen = [...new Set([...canonFirst, ...order])].slice(0, Math.max(seats, canonFirst.length));
    return chosen.map(k => ({ ...list[k], strength: Math.round(strength * 10) / 10 }));
  });
  // a town is ruled by a few houses, not one per pair: keep the strongest lineages up to the cap
  const cap = burg.capital ? LINEAGES_CAPITAL : LINEAGES_TOWN;
  let lineages = 0;
  const kept = institutions.filter(
    item => item.canon || KINDS.find(kind => kind.id === item.kind)?.rarity === undefined || ++lineages <= cap
  );
  // the canon institution of the town's own people (a canon culture's own lineage, say) always has a seat
  const people = (pack.cultures[burg.culture ?? 0] as { artae?: string } | undefined)?.artae;
  for (const item of canonInstitutions().filter(example => example.id === people)) {
    if (kept.some(present => present.canon === item.id)) continue;
    const primary = elementIndex(item.elements?.[0]);
    const secondary = elementIndex(item.elements?.[1] ?? item.elements?.[0]);
    const own = primary >= 0 && secondary >= 0 && archetypes(primary, secondary).find(a => a.canon === item.id);
    if (own) kept.unshift({ ...own, strength: Math.round(((2 * levels[primary] + levels[secondary]) / 3) * 10) / 10 });
  }
  return { levels, institutions: kept };
}
