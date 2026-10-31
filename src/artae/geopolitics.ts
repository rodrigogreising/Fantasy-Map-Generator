// Artae: magical geopolitics: each realm's nodes and the mana composition of its territory, strong realm
// borders for the "geopolitica" preset, the realm hover tip and an overview dialog
import { hsl, rgb } from "d3";
import { ELEMENTS } from "@/artae/elements";
import { cachedField, findNode, manaTip, nodes } from "@/artae/nodes";
import { profile } from "@/artae/profile";
import { Pack } from "@/model/graph/pack-generator";
import { Layers } from "@/renderers/layers";
import { Dialog } from "@/ui/dialog/dialog";
import { ensureEl, findEl } from "@/utils/node-utils";

export interface RealmProfile {
  state: number;
  name: string;
  color: string;
  nodes: number[]; // node ids
  maxLevel: number;
  levelSum: number;
  composition: number[]; // share of each element, 0..1, by ELEMENTS index
}

let cache:
  | { cells: unknown; signature: string; realms: Map<number, RealmProfile>; nodeState: Map<number, number> }
  | undefined;

function compute() {
  const { cells, states } = pack;
  const list = nodes();
  const { owner, level } = cachedField();
  const realms = new Map<number, RealmProfile>();
  for (const state of states) {
    if (!state.i || state.removed) continue;
    realms.set(state.i, {
      state: state.i,
      name: state.fullName || state.name || `#${state.i}`,
      color: state.color || "#888",
      nodes: [],
      maxLevel: 0,
      levelSum: 0,
      composition: new Array(ELEMENTS.length).fill(0)
    });
  }

  const nodeState = new Map<number, number>();
  for (const node of list) {
    const cell = Pack.findCell(node.x, node.y);
    const stateId = cell === undefined ? 0 : cells.state[cell];
    nodeState.set(node.i, stateId);
    const realm = realms.get(stateId);
    if (!realm) continue;
    realm.nodes.push(node.i);
    realm.maxLevel = Math.max(realm.maxLevel, node.node.level);
    realm.levelSum += node.node.level;
  }

  for (let cell = 0; cell < cells.i.length; cell++) {
    const realm = realms.get(cells.state[cell]);
    if (!realm) continue;
    const g = cells.g[cell];
    const node = list[owner[g]];
    if (!node) continue;
    realm.composition[node.node.primary] += (level[g] * 2) / 3;
    realm.composition[node.node.secondary] += level[g] / 3;
  }
  for (const realm of realms.values()) {
    const total = realm.composition.reduce((sum, value) => sum + value, 0);
    if (total) realm.composition = realm.composition.map(value => value / total);
  }
  return { realms, nodeState };
}

/** Every realm's magical profile, cached until the map or its nodes change */
export function realms(): Map<number, RealmProfile> {
  return cached().realms;
}

function cached() {
  const signature = `${pack.states.length}:${nodes()
    .map(n => `${n.i}:${n.node.gridCell}:${n.node.level}`)
    .join(",")}`;
  if (cache?.cells !== pack.cells || cache.signature !== signature)
    cache = { cells: pack.cells, signature, ...compute() };
  return cache;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The strongest elements of a realm, as "Fire 31%, Earth 18%, Air 12%" */
function topElements(realm: RealmProfile, count = 3): string {
  return realm.composition
    .map((share, e) => [share, e] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, count)
    .filter(([share]) => share > 0)
    .map(([share, e]) => `${ELEMENTS[e].name} ${percent(share)}`)
    .join(", ");
}

/** " · Reino de Gres" for a node inside a realm, empty outside any */
export function nodeRealmSuffix(nodeId: number): string {
  const realm = realms().get(cached().nodeState.get(nodeId) ?? 0);
  return realm ? ` · ${realm.name}` : "";
}

/** The hover tip of a realm cell: its profile, then the mana at that spot */
export function realmTip(cellId: number, gridCellId: number): string {
  const realm = realms().get(pack.cells.state[cellId]);
  if (!realm) return manaTip(gridCellId);
  const count = realm.nodes.length;
  const nodesText = count ? `${count} nodos (máx. nivel ${realm.maxLevel})` : "sin nodos";
  const mana = manaTip(gridCellId);
  return `${mana ? `${mana} — ` : ""}${realm.name} · ${nodesText}`;
}

/** Realms sorted by node count, then by their strongest node */
/** A realm's power: the mana of the nodes it holds added as powers of the profile's base (Σ base^level), the
 * measure of how many high-level fighters it can field; `poderNivel` is the same as a single level */
export function realmPower(realm: RealmProfile): number {
  const base = profile().levelBase;
  return realm.nodes.reduce((sum, id) => sum + base ** (findNode(id)?.node.level ?? 0), 0);
}

export function geopoliticsTable() {
  const base = profile().levelBase;
  return [...realms().values()]
    .sort((a, b) => realmPower(b) - realmPower(a))
    .map(realm => {
      const poder = realmPower(realm);
      return {
        realm: realm.name,
        nodes: realm.nodes.length,
        maxLevel: realm.maxLevel,
        levels: realm.levelSum,
        poder: Math.round(poder),
        poderNivel: poder > 0 ? Math.round((Math.log(poder) / Math.log(base)) * 10) / 10 : 0,
        top: topElements(realm)
      };
    });
}

const escapeText = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

/** A dialog listing every realm with a stacked bar of its mana composition in element colours */
export function showGeopolitics(): void {
  const id = "artaeGeopolitics";
  let content = findEl(id);
  if (!content) {
    content = document.createElement("div");
    content.id = id;
    ensureEl("dialogs").append(content);
  }
  const sorted = [...realms().values()].sort((a, b) => b.nodes.length - a.nodes.length || b.maxLevel - a.maxLevel);
  const rows = sorted.map(realm => {
    const bar = realm.composition
      .map((share, e) => [share, e] as const)
      .filter(([share]) => share > 0.005)
      .sort((a, b) => b[0] - a[0])
      .map(
        ([share, e]) =>
          `<span title="${ELEMENTS[e].name} ${percent(share)}" style="flex:${share};background:${ELEMENTS[e].color}"></span>`
      )
      .join("");
    return `<tr>
      <td><span style="display:inline-block;width:.8em;height:.8em;background:${realm.color};border:1px solid #0006;margin-right:.3em"></span>${escapeText(realm.name)}</td>
      <td style="text-align:right">${realm.nodes.length}</td>
      <td style="text-align:right">${realm.maxLevel || "–"}</td>
      <td style="min-width:12em"><div style="display:flex;height:.9em;border:1px solid #0004">${bar}</div>
        <div style="font-size:.85em;opacity:.8">${escapeText(topElements(realm))}</div></td>
    </tr>`;
  });
  content.innerHTML = `<div style="max-height:60vh;overflow:auto">
    <table style="width:100%;border-collapse:collapse;font-size:.9em">
      <thead><tr><th style="text-align:left">Reino</th><th>Nodos</th><th>Máx.</th><th style="text-align:left">Mana del territorio</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>`;
  Dialog.open(id, { title: "Geopolítica mágica", width: "40em", resizable: true });
}

const MANA_TINT = "0.8"; // low levels are near transparent already, so mana can sit over realm colours

/** Realm borders, thick and dark over everything but the nodes: one segment per cell edge between two realms, or
 * between a realm and unclaimed land. The coast stays unstroked */
export function drawRealmBorders(): void {
  const { cells, vertices } = pack;
  const segments: string[] = [];
  for (let cell = 0; cell < cells.i.length; cell++) {
    const state = cells.state[cell];
    if (!state) continue;
    for (const next of cells.c[cell]) {
      const other = cells.state[next];
      if (other === state) continue;
      if (other && other > state) continue; // each shared edge once
      if (!other && cells.h[next] < 20) continue; // coastline, not a border
      const shared = cells.v[cell].filter(v => cells.v[next].includes(v));
      if (shared.length < 2) continue;
      const [a, b] = [vertices.p[shared[0]], vertices.p[shared[1]]];
      segments.push(`M${a[0]},${a[1]}L${b[0]},${b[1]}`);
    }
  }
  const d = segments.join("");
  ensureEl("realmBorders").innerHTML =
    `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="3.2" stroke-linecap="round" />
    <path d="${d}" fill="none" stroke="#1b1611" stroke-width="1.5" stroke-linecap="round" />`;
  const mana = findEl("elements");
  if (mana) {
    mana.style.opacity = MANA_TINT;
    ensureEl("realmBorders").before(mana); // over the realm fills, under the borders: high-level mana shows inside realms
  }
  ensureGeopoliticsButton(true);
}

export function eraseRealmBorders(): void {
  ensureEl("realmBorders").innerHTML = "";
  const mana = findEl("elements");
  if (mana) {
    mana.style.removeProperty("opacity");
    findEl("biomes")?.after(mana); // back to its registry place
  }
  ensureGeopoliticsButton(false);
}

/** A button in the layers tab that opens the overview while the realm borders are on */
function ensureGeopoliticsButton(visible: boolean): void {
  const anchor = findEl("layersOrderButton");
  if (!anchor) return;
  let button = findEl<HTMLButtonElement>("artaeGeopoliticsButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "artaeGeopoliticsButton";
    button.className = "sideButton";
    button.textContent = "Reinos";
    button.dataset.tip = "Geopolítica mágica: nodos y mana de cada reino";
    button.onclick = () => showGeopolitics();
    anchor.after(button);
  }
  button.style.display = visible ? "" : "none";
}

const ESSENCE_ELEMENTS = 4; // how many over-represented elements blend into a realm's colour
const ESSENCE_SATURATION = 0.6; // at least this saturated, so realms read apart; blends of hues drift to grey otherwise
const ESSENCE_LIGHTNESS = [0.45, 0.68] as const; // kept in this band so labels and borders stay readable

/** A realm's colour from its essence: the elements it holds more of than the average realm, blended by that excess.
 * A plain average of every element would turn every large realm the same muddy grey */
function essenceColor(composition: number[], average: number[]): string {
  const excess = composition.map((share, element) => ({ element, weight: Math.max(0, share - average[element]) }));
  const top = excess
    .sort((a, b) => b.weight - a.weight)
    .slice(0, ESSENCE_ELEMENTS)
    .filter(({ weight }) => weight > 0);
  const picks = top.length
    ? top
    : composition
        .map((weight, element) => ({ element, weight }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 1);
  const total = picks.reduce((sum, { weight }) => sum + weight, 0) || 1;
  const mix = picks.reduce(
    (sum, { element, weight }) => {
      const { r, g, b } = rgb(ELEMENTS[element].color);
      return [sum[0] + (r * weight) / total, sum[1] + (g * weight) / total, sum[2] + (b * weight) / total];
    },
    [0, 0, 0]
  );
  const color = hsl(rgb(mix[0], mix[1], mix[2]));
  color.s = Math.max(color.s || 0, ESSENCE_SATURATION);
  color.l = Math.min(ESSENCE_LIGHTNESS[1], Math.max(ESSENCE_LIGHTNESS[0], color.l));
  return color.formatHex();
}

/** Paint every realm in the colour of its average essence; returns how many were recoloured */
export function colorRealmsByEssence(): number {
  const list = [...realms().values()].filter(realm => realm.composition.some(share => share > 0));
  if (!list.length) return 0;
  const average = ELEMENTS.map(
    (_, element) => list.reduce((sum, realm) => sum + realm.composition[element], 0) / list.length
  );
  for (const realm of list) pack.states[realm.state].color = essenceColor(realm.composition, average);
  Layers.draw("states");
  return list.length;
}
