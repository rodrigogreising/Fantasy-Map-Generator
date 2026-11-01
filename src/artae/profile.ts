// Artae: the world profile. Everything that belongs to a setting rather than to the generator lives in a JSON profile:
// its elements and how geography expresses them, node levels, the pantheon tints and the institution kinds, and the
// few texts generated from them. The dev server serves a setting's profile from the Artae repo
// (map/profiles/<setting>.json); without one, the neutral default below is used. See artae/README.md
import defaultJson from "@/artae/default-profile.json";

export interface ProfilePole {
  label: string;
  rule: string; // expression, see src/artae/expressions.ts
}

export interface ProfileElement {
  name: string;
  family: string; // a free grouping, shown on hover
  color: string; // distinct from every other element's
  rule?: string; // expression for elements without poles
  poles?: ProfilePole[]; // states or ends of an axis: each has its own rule, the strongest wins in a cell
  gender?: "m" | "f"; // grammar for generated names (see grammar)
  article?: "m" | "f"; // article when it differs from the gender
  adjective?: [string, string]; // masculine, feminine: the element as the second word of a pair
  roots?: { head: string[]; tail: string[] }; // word parts for realm and province names (see grammar.realm)
}

export interface ProfileTint {
  name: string;
  strategy: string;
  color: string;
}

export interface ProfileKind {
  id: string;
  label: string;
  aliases?: string[]; // other names a canon example may use for this kind
  rarity?: number; // 0..1: share of small towns that host it; capitals and large towns always may
  names: string[]; // patterns with {de}, {el}, {al}: the pair phrase with its article (see grammar)
  purpose: Record<string, string>; // one per tint name
}

/** A trophic role of the ecology snapshot (see src/artae/ecology.ts) */
export interface ProfileRole {
  id: string;
  label: string;
  diet: string[]; // role ids it eats; "mana" for the node's budget, "residual" for residual essence
  eats: number; // 0..1: share of its prey's standing energy (or of the residual) it consumes
  efficiency: number; // 0..1: share of what it consumes it keeps, before the element overlap
  levelShare: number; // 0..1: typical level as a share of the node's level, before bonuses
  archetypes: number; // archetypes of this role per node region, 1..3
  names: string[]; // name patterns with {de}, {el}, {al} (the pair phrase) and {biome}
}

export interface ProfileEcology {
  roles: ProfileRole[]; // in feeding order: producers first
  apex: string; // role id of the region's notable creature
  selfSustaining: number; // 0..1: share of each population with enough essence of its own to live off the budget
  overlapFloor: number; // 0..1: assimilation factor between creatures that share no element
  bonus: { age: number; competition: number; richness: number }; // levels added at most by each factor
  notable: string[]; // patterns for the notable creature: {name} (a generated proper name) and {archetype}
  biomes?: Record<string, string>; // the generator's biome names, translated for {biome}
  texts: {
    layer: string;
    title: string;
    input: string;
    stock: string;
    residual: string;
    selfSustaining: string;
    notable: string;
    fauna: string;
    level: string;
    density: string;
    cells: string;
    lvl: string; // short "level" for labels
  };
}

export interface Profile {
  name: string;
  levels: [number, number]; // node level range
  levelBase: number; // mana levels add as powers of this base
  texts: { node: string; nodePair: string }; // node names, with {a} and {b}
  grammar: {
    pair: string; // pair phrase from {noun} and {adjective}
    pure: [string, string]; // adjective of a pure pair, masculine and feminine
    realm?: string; // realm and province names from {head} (strongest element) and {tail} (the next); default "{head}{tail}"
    articles: Record<"m" | "f", { el: string; de: string; al: string }>;
  };
  elements: ProfileElement[];
  tints: ProfileTint[];
  kinds: ProfileKind[];
  finder?: [string, string?]; // the pair the node finder opens on, by element names
  ecology?: ProfileEcology; // the static ecology snapshot; the default profile's is used when a setting has none
}

const defaultProfile = defaultJson as unknown as Profile;
let current: Profile = defaultProfile;
let currentSetting: string | undefined;
const listeners = new Set<(profile: Profile) => void>();

export const profile = (): Profile => current;

/** The ecology parameters of the profile in use, falling back to the default profile's */
export const ecologyProfile = (): ProfileEcology => current.ecology ?? (defaultProfile.ecology as ProfileEcology);

/** Run a function now and whenever the profile changes */
export function onProfile(listener: (profile: Profile) => void): void {
  listeners.add(listener);
  listener(current);
}

function setProfile(next: Profile, setting: string | undefined): void {
  current = next;
  currentSetting = setting;
  for (const listener of listeners) listener(next);
}

/** The setting of a repo map name: its first path segment ("world/layer" → "world") */
export const settingOf = (map: string | undefined) => map?.split("/")[0] || undefined;

/** Load a setting's profile from the dev server, or fall back to the default; resolves once it is in use */
export async function loadProfile(setting: string | undefined): Promise<Profile> {
  if (setting === currentSetting) return current;
  if (!setting) {
    setProfile(defaultProfile, undefined);
    return current;
  }
  try {
    const response = await fetch(`/artae/api/profile/${encodeURIComponent(setting)}`);
    setProfile(response.ok ? ((await response.json()) as Profile) : defaultProfile, setting);
  } catch {
    setProfile(defaultProfile, setting);
  }
  return current;
}
