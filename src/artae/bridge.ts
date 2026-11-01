// Artae bridge, browser side: `window.artae` loads and saves the repo's maps, applies operations with undo,
// and ties map entities to canon articles. See artae/README.md

import { applyPreset } from "@/app/layers-presets";
import { regenerateMap } from "@/app/lifecycle";
import { ecology, ecologySummary } from "@/artae/ecology";
import { showEcology } from "@/artae/ecology-view";
import { ELEMENTS, elementLabel } from "@/artae/elements";
import { colorRealmsByEssence, geopoliticsTable, showGeopolitics } from "@/artae/geopolitics";
import { archetypesByName, townInstitutions } from "@/artae/institutions";
import { canonKey } from "@/artae/lore";
import { affinity, cachedField, findNode, generateNodes, NODE_KEY, nodes } from "@/artae/nodes";
import { regeneratePolitics } from "@/artae/politics";
import { loadProfile, profile, settingOf } from "@/artae/profile";
import { upgradeMap } from "@/artae/upgrade";
import { AssistantMap } from "@/controllers/assistant/map";
import { METHODS, MODELS } from "@/controllers/assistant/operations";
import { Proposals } from "@/controllers/assistant/proposals";
import { Grid } from "@/model/graph/grid-generator";
import { ENTITY_TYPES, type EntityType, MapEntities } from "@/model/map-entities";
import { mapHistory } from "@/model/map-history";
import { Pins } from "@/model/options/pins";
import { Notes } from "@/model/story/notes";
import { Layers } from "@/renderers/layers";
import type { Proposal } from "@/services/assistant/chats";
import { Load } from "@/services/io/load";
import { Save } from "@/services/io/save";
import { findEl } from "@/utils/node-utils";

interface Article {
  id: string;
  title: string;
  type: string;
  setting: string;
  status: string;
  path: string;
  summary: string;
  map: string[];
}

const canonLink = (id: string) => `/artae/canon/${id}`;

let current: string | undefined; // the repo map on screen, mirrored in ?artae=
let currentEntry: (typeof mapHistory)[number] | undefined; // its history entry: a new map on screen drops the name
const applied: Proposal[] = [];
let proposalNumber = 0;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

const waitFor = (test: () => boolean, timeout = 120000) =>
  new Promise<void>((done, fail) => {
    const started = Date.now();
    const tick = () => {
      if (test()) return done();
      if (Date.now() - started > timeout) return fail(new Error("Timed out waiting for the map"));
      setTimeout(tick, 200);
    };
    tick();
  });

function setCurrent(name: string | undefined): void {
  current = name;
  currentEntry = name ? mapHistory.at(-1) : undefined;
  const url = new URL(location.href);
  if (name) url.searchParams.set("artae", name);
  else url.searchParams.delete("artae");
  history.replaceState(null, "", url);
}

/** Maps saved in the repo under map/worlds */
const maps = () => json<{ name: string; updated: string }[]>("/artae/api/maps");

const MAP_PRESET = "geopolitica";

/** Open a repo map, such as "world/layer", with its setting's profile; resolves once it is on screen */
async function load(name: string): Promise<void> {
  await loadProfile(settingOf(name)); // the nodes and mana of the file are read with its setting's elements
  const response = await fetch(`/artae/api/maps/${name}.map`);
  if (!response.ok) throw new Error(`No map ${name}`);
  const before = mapHistory.length;
  Load.uploadMap(await response.blob());
  await waitFor(() => mapHistory.length > before);
  applied.length = 0;
  setCurrent(name);
  applyPreset(MAP_PRESET); // the file restores the layers it was saved with; repo maps open on nodes and mana
  void refresh3d();
}

/** Save the map on screen to the repo, under its current name or a new one */
async function save(name = bridge.current): Promise<string> {
  if (!name) throw new Error("Name the map: artae.save('world/layer')");
  const result = await json<{ saved: string }>(`/artae/api/maps/${name}.map`, {
    method: "PUT",
    body: Save.prepareMapData()
  });
  setCurrent(name);
  return result.saved;
}

/** Run a batch of operations, as `{ op: "Burgs.rename", args: [12, "Capital"] }`, and redraw. All or nothing.
 * `{ result: n }` in args is what operation n of the batch returned, `{ result: n, type: "burg" }` its key */
async function apply(summary: string, operations: { op: string; args?: unknown[] }[]) {
  await Proposals.prepare(operations);
  const proposal = Proposals.propose(summary, operations, ++proposalNumber, AssistantMap.id());
  if (typeof proposal === "string") throw new Error(proposal);
  if (!Proposals.run("apply", proposal, AssistantMap.id())) throw new Error("The map changed under the batch, retry");
  applied.push(proposal);
  void refresh3d();
  return proposal.change.map(({ entity, field, before, after }) => ({ entity, field, before, after }));
}

/** Undo the last batch applied through `apply` */
function undo(): string {
  const proposal = applied.pop();
  if (!proposal) throw new Error("Nothing to undo");
  if (!Proposals.run("undo", proposal, AssistantMap.id())) throw new Error("The map changed since, cannot undo");
  return proposal.summary;
}

/** Every operation `apply` accepts, by model */
const operations = () => METHODS;

/** Entities of a type as short rows: key, name, locked, has note */
function entities(type: EntityType) {
  return MapEntities.collect(type).map(({ ref, entity }) => ({
    key: MapEntities.key(ref),
    name: MapEntities.getName(ref),
    lock: !!(entity as { lock?: boolean }).lock,
    note: !!(entity as { note?: string }).note
  }));
}

/** Entities whose name contains the text, across every type */
function find(text: string) {
  const needle = text.toLowerCase();
  return ENTITY_TYPES.flatMap(type => entities(type).filter(row => row.name?.toLowerCase().includes(needle)));
}

const canon = () => json<Article[]>("/artae/api/canon");

/** Anchors of canon articles that point into the map on screen, as entity key → article */
async function anchored(): Promise<Map<string, Article>> {
  const linked = new Map<string, Article>();
  for (const article of await canon())
    for (const anchor of article.map) {
      const [file, key] = anchor.split("#");
      if (file !== bridge.current || !key) continue;
      // "#canon": whatever this map generated from the article (src/artae/lore.ts), whatever its id this run
      const resolved = key === "canon" ? canonKey(article.id) : key;
      if (resolved) linked.set(resolved, article);
    }
  return linked;
}

function noteFor(article: Article): string {
  const summary = article.summary.replace(/\[\[([a-z0-9-]+)\]\]/g, "$1").replace(/[<>&]/g, "");
  return `<p><strong>${article.title}</strong> <em>(${article.status})</em></p><p>${summary}</p><p><a href="${canonLink(article.id)}">Artículo del canon →</a></p>`;
}

/** Write each anchored article into its entity's note and lock the entity; returns what was linked and what is broken */
async function sync() {
  if (!bridge.current) throw new Error("Load or save a repo map first");
  const linked: string[] = [];
  const broken: string[] = [];
  for (const [key, article] of await anchored()) {
    if (key.startsWith(`${NODE_KEY}:`)) {
      const node = findNode(Number(key.slice(NODE_KEY.length + 1)));
      if (!node) broken.push(`${article.id} → ${key}`);
      else {
        node.note = noteFor(article);
        node.lock = true;
        linked.push(`${key} ${node.name} → ${article.id}`);
      }
      continue;
    }
    const ref = MapEntities.parseKey(key);
    const entity = ref && MapEntities.get(ref);
    if (!ref || !entity) {
      broken.push(`${article.id} → ${key}`);
      continue;
    }
    Notes.write(key, noteFor(article));
    (entity as { lock?: boolean }).lock = true;
    linked.push(`${key} ${MapEntities.getName(ref)} → ${article.id}`);
  }
  Layers.draw("nodes");
  return { linked, broken };
}

/** Named entities on the map that no canon article anchors yet, by type */
async function unlinked(
  types: EntityType[] = [
    "state",
    "province",
    "burg",
    "culture",
    "religion",
    "marker",
    "river",
    "route",
    "zone",
    "feature"
  ]
) {
  const linked = await anchored();
  return Object.fromEntries(
    types.map(type => [
      type,
      entities(type)
        .filter(row => row.name && !linked.has(row.key))
        .map(row => `${row.key} ${row.name}`)
    ])
  );
}

let pipelineOwner: string | undefined; // who is running the pipeline now, so the watcher doesn't run it twice

/** Terrain → nodes → civilization, on the map on screen; the setting is the one in ?artae= (its profile) */
async function runPipeline(setting = settingOf(new URL(location.href).searchParams.get("artae") ?? undefined)) {
  if (setting) await loadProfile(setting);
  generateNodes();
  const politics = await regeneratePolitics();
  Layers.draw("nodes", "elements");
  return politics;
}

/** The map on screen was just generated, not loaded from a file (a loaded map keeps its file's creation date), and
 * it is not the throwaway map the page generates at boot before opening the repo map named in ?artae= */
function isFreshlyGenerated(): boolean {
  const entry = mapHistory.at(-1);
  if (!entry || pack.artaeNodes?.length) return false;
  if (mapHistory.length === 1 && new URL(location.href).searchParams.get("artae")) return false;
  return Math.abs(entry.registeredAt - entry.created) < 10000;
}

/** Generate a new whole-planet map (equirectangular, 2:1) and wait for it. The settings are pinned, so the
 * generator keeps them for later maps too; the repo name is dropped until saved. `setting` picks the world profile
 * (its elements, tints…); without it the default profile is used */
async function newWorld({
  template = "continents",
  density = 8,
  width = 2048,
  seed,
  setting
}: {
  template?: string;
  density?: number;
  width?: number;
  seed?: string;
  setting?: string;
} = {}) {
  await loadProfile(setting);
  const pins = {
    mapWidth: width,
    mapHeight: width / 2,
    points: density,
    template,
    mapSize: 100,
    latitude: 50,
    longitude: 50
  };
  for (const [key, value] of Object.entries(pins)) Pins.set(key, value);
  options.generation.graph.width = width;
  options.generation.graph.height = width / 2;
  const before = mapHistory.length;
  pipelineOwner = "newWorld";
  regenerateMap(seed ? { seed } : "artae new world");
  await waitFor(() => mapHistory.length > before, 600000);
  const politics = await runPipeline(setting);
  pipelineOwner = undefined;
  return {
    seed: options.map.seed,
    gridCells: grid.cells.i.length,
    coordinates: options.map.geography.coordinates,
    nodes: nodes().length,
    ...politics
  };
}

type View = "viewStandard" | "viewMesh" | "viewGlobe";
const VIEW_KEY = "artae:view";
const defaultView = (): View => {
  try {
    return (localStorage.getItem(VIEW_KEY) as View | null) ?? "viewStandard";
  } catch {
    return "viewStandard";
  }
};

/** Show the map in a view: "viewMesh" (3D scene), "viewGlobe" or "viewStandard" (2D, the only one for editing by hand) */
async function view(mode: View = defaultView()): Promise<void> {
  const { View3d } = await import("@/controllers/view-3d");
  if (mode === "viewStandard") return View3d.enterStandard();
  await View3d.open(mode);
  if (findEl("options3d")) View3d.toggleOptions(); // the options dialog opens with the view; keep the scene clear
}

/** The view every map opens in; the 2D map unless changed */
function setDefaultView(mode: View): Promise<void> {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {}
  return view(mode);
}

async function refresh3d(): Promise<void> {
  const { View3d } = await import("@/controllers/view-3d");
  if (View3d.isOn()) await View3d.update();
}

/** The setting's nodes and their elemental regions */
const nodeTools = {
  get elements() {
    return ELEMENTS;
  },
  /** Replace all unlocked nodes, then rebuild the civilization on them (it sits on the nodes), unless
   * `politics: false`; redraws */
  async generate({ politics = true, ...options }: { extra?: number; politics?: boolean } = {}) {
    const made = generateNodes(options);
    if (politics) await regeneratePolitics();
    Layers.draw("nodes", "elements");
    void refresh3d();
    return {
      nodes: made.length,
      pairs: new Set(made.map(m => m.node.primary * ELEMENTS.length + m.node.secondary)).size
    };
  },
  list: () =>
    nodes().map(({ i, name, lock, node }) => ({ key: `${NODE_KEY}:${i}`, name, level: node.level, lock: !!lock })),
  /** The node whose region holds a map point, and the three elements strongest there */
  at(x: number, y: number) {
    const cell = Grid.findCell(x, y);
    const list = nodes();
    const field = cachedField();
    const owner = field.owner[cell];
    const { value, pole } = affinity();
    const strongest = ELEMENTS.map((_, e) => e)
      .sort((a, b) => value[b][cell] - value[a][cell])
      .slice(0, 3)
      .map(e => `${elementLabel(e, pole[e][cell])} ${value[e][cell].toFixed(2)}`);
    const node = list[owner];
    return {
      node: node && { key: `${NODE_KEY}:${node.i}`, name: node.name, level: node.node.level },
      level: Math.round(field.level[cell] * 10) / 10,
      strongest
    };
  },
  /** Region size in cells per node, largest first */
  sizes() {
    const { owner } = cachedField();
    const list = nodes();
    const counts = new Array(list.length).fill(0);
    for (const index of owner) if (index >= 0) counts[index]++;
    return list
      .map((m, k) => ({ name: m.name, level: m.node.level, cells: counts[k] }))
      .sort((a, b) => b.cells - a.cells);
  },
  get: findNode
};

/** Show only these layers, such as ["states", "burgIcons", "labels"] */
const show = (...ids: string[]) => Layers.set(ids);

const bridge = {
  get current() {
    return currentEntry === mapHistory.at(-1) ? current : undefined;
  },
  maps,
  load,
  save,
  newWorld,
  /** The world profile in use, and loading another setting's */
  profile,
  loadProfile,
  regeneratePolitics,
  ecology,
  ecologySummary,
  showEcology,
  upgradeMap,
  view,
  setDefaultView,
  apply,
  undo,
  operations,
  entities,
  find,
  canon,
  sync,
  unlinked,
  show,
  nodes: nodeTools,
  /** Realms with their nodes, strongest node and top mana elements */
  geopolitics: geopoliticsTable,
  institutions: townInstitutions,
  institutionArchetypes: archetypesByName,
  colorRealms: colorRealmsByEssence,
  showGeopolitics,
  models: MODELS,
  layers: Layers,
  notes: Notes,
  canonLink
};

declare global {
  var artae: typeof bridge;
}
globalThis.artae = bridge;

// every map that comes on screen opens in the default view; a freshly generated one (the generator's own "New map"
// included) goes through the pipeline first: its terrain gives rise to nodes, and the civilization is rebuilt on them
let shownMaps = 0;
setInterval(() => {
  if (mapHistory.length === shownMaps) return;
  shownMaps = mapHistory.length;
  if (isFreshlyGenerated() && !pipelineOwner) {
    pipelineOwner = "watcher";
    void runPipeline()
      .then(() => applyPreset(MAP_PRESET))
      .finally(() => (pipelineOwner = undefined));
  }
  if (defaultView() !== "viewStandard") void view();
}, 1000);

// ?artae=<world>/<layer> opens that repo map once the first one is on screen
const requested = new URL(location.href).searchParams.get("artae")?.split("#")[0];
if (requested) void waitFor(() => mapHistory.length > 0).then(() => load(requested));
