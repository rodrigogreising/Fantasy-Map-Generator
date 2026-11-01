// Artae: how the ecology snapshot shows on the map. The "fauna" layer shades each node region by its fauna's mean
// level (steps like the mana layer), a click on a node opens its region's food web, and the mana panel gets a fauna line
import { type Ecology, ecology, ecologyAt } from "@/artae/ecology";
import { ELEMENTS } from "@/artae/elements";
import { cachedField, findNode, nodes } from "@/artae/nodes";
import { ecologyProfile, profile } from "@/artae/profile";
import { rasterImage } from "@/artae/raster";
import { Dialog } from "@/ui/dialog/dialog";
import { ensureEl } from "@/utils/node-utils";
import { getIsolines } from "@/utils/path-utils";

const BAND_STEP = 3;
const BAND_OPACITY = [0.04, 0.14, 0.24, 0.38, 0.5, 0.6, 0.7, 0.78, 0.85, 0.9, 0.94];
const FAUNA_COLOR = "#7a4a1c";

const escapeText = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
const round = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1));

/** The fauna layer: every region shaded by its fauna's mean level */
export function drawFauna(): void {
  const group = ensureEl("fauna");
  const list = nodes();
  if (!list.length) {
    group.innerHTML = "";
    return;
  }
  const { owner } = cachedField();
  const levels = list.map(node => ecology(node.i)?.meanLevel ?? 0);
  const band = (cell: number) =>
    owner[cell] < 0 ? null : Math.min(BAND_OPACITY.length - 1, Math.floor(levels[owner[cell]] / BAND_STEP));
  const isolines = getIsolines(grid as unknown as Parameters<typeof getIsolines>[0], band, { fill: true });
  group.innerHTML = rasterImage(
    Object.entries(isolines).map(([key, { fill }]) => ({ d: fill, color: FAUNA_COLOR, opacity: BAND_OPACITY[+key] }))
  );
}

/** A line for the mana panel: the fauna of the region under the pointer */
export function faunaLine(gridCell: number): string {
  const region = ecologyAt(gridCell);
  if (!region) return "";
  const { texts } = ecologyProfile();
  const top = region.species
    .filter(s => s.count)
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 3)
    .map(s => s.name)
    .join(", ");
  return `${texts.fauna}: ${texts.level} ${region.meanLevel.toFixed(1)} · ${round(region.density)} ${texts.density} · ${top}`;
}

/** A label split into at most two lines at word boundaries, so neighbouring names don't overlap */
function wrap(name: string): string[] {
  if (name.length <= LINE) return [name];
  const words = name.split(" ");
  let first = "";
  while (words.length && `${first} ${words[0]}`.trim().length <= LINE) first = `${first} ${words.shift()}`.trim();
  if (!first) first = words.shift() ?? "";
  const rest = words.join(" ");
  return rest ? [first, rest.length > LINE + 6 ? `${rest.slice(0, LINE + 5)}…` : rest] : [first];
}

const ROW = 108;
const LINE = 20; // characters per label line; long species names wrap onto a second line
const WIDTH = 640;

/** The region's food web as a layered graph: roles as rows (producers at the bottom), species coloured by their pair */
function web(region: Ecology): string {
  const { roles, texts } = ecologyProfile();
  const rows = roles.map(role => region.species.filter(s => s.role === role.id));
  const height = ROW * (rows.length + 1);
  const position = new Map<string, [number, number]>();
  rows.forEach((species, r) => {
    const y = height - ROW * (r + 1);
    for (const [k, s] of species.entries()) position.set(s.id, [((k + 1) * WIDTH) / (species.length + 1), y]);
  });
  position.set("mana", [WIDTH / 2, height - 18]);
  const maxFlow = Math.max(...region.links.map(link => link.flow), 1);
  const edges = region.links
    .filter(link => link.flow > 0 && link.food !== "residual")
    .map(link => {
      const [x1, y1] = position.get(link.food) ?? [0, 0];
      const [x2, y2] = position.get(link.eater) ?? [0, 0];
      const width = 0.6 + 5 * Math.sqrt(link.flow / maxFlow);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8888" stroke-width="${width.toFixed(1)}" />`;
    })
    .join("");
  const scavenging = region.links
    .filter(link => link.food === "residual")
    .map(link => {
      const [x, y] = position.get(link.eater) ?? [0, 0];
      return `<line x1="${x}" y1="${y}" x2="${x}" y2="${height - 18}" stroke="#a0784a88" stroke-dasharray="3 3" />`;
    })
    .join("");
  const labels = roles
    .map(
      (role, r) =>
        `<text x="6" y="${height - ROW * (r + 1) - 26}" font-size="11" fill="#999">${escapeText(role.label)}</text>`
    )
    .join("");
  const circles = region.species
    .map(s => {
      const [x, y] = position.get(s.id) ?? [0, 0];
      const r = 8 + Math.min(14, s.level / 2);
      const faded = s.count ? "" : ' opacity="0.35"';
      return `<g${faded}><circle cx="${x}" cy="${y}" r="${r}" fill="${ELEMENTS[s.primary].color}" stroke="${ELEMENTS[s.secondary].color}" stroke-width="3" />
        ${wrap(s.name)
          .map(
            (line, k) =>
              `<text x="${x}" y="${y + r + 12 + k * 12}" font-size="10.5" text-anchor="middle" fill="currentColor">${escapeText(line)}</text>`
          )
          .join("")}
        <text x="${x}" y="${y + r + 12 + wrap(s.name).length * 12}" font-size="10" text-anchor="middle" fill="#999">${texts.lvl} ${s.level} · ${round(s.count)}</text></g>`;
    })
    .join("");
  const source = `<circle cx="${WIDTH / 2}" cy="${height - 18}" r="7" fill="#fff" stroke="#888" /><text x="${WIDTH / 2 + 12}" y="${height - 14}" font-size="11" fill="#999">mana</text>`;
  return `<svg viewBox="0 0 ${WIDTH} ${height}" width="100%" style="max-height:60vh">${scavenging}${edges}${labels}${source}${circles}</svg>`;
}

/** Open the food web and essence flow of a node's region */
export function showEcology(nodeId: number): void {
  const region = ecology(nodeId);
  const node = findNode(nodeId);
  if (!region || !node) return;
  const { texts } = ecologyProfile();
  const id = "artaeEcology";
  let content = document.getElementById(id);
  if (!content) {
    content = document.createElement("div");
    content.id = id;
    ensureEl("dialogs").append(content);
  }
  const level = (energy: number) => (energy > 1 ? Math.log(energy) / Math.log(profile().levelBase) : 0);
  const self = region.species.reduce((sum, s) => sum + s.selfSustaining, 0);
  const flow = [
    [texts.input, region.input],
    [texts.stock, region.stock],
    [texts.residual, region.residual]
  ]
    .map(
      ([label, energy]) =>
        `<tr><td>${label}</td><td style="text-align:right">${round(energy as number)}</td><td style="text-align:right;opacity:.7">≈ ${texts.lvl} ${level(energy as number).toFixed(1)}</td></tr>`
    )
    .join("");
  const notable = region.notable
    ? `<p><b>${texts.notable}:</b> ${escapeText(region.notable.name)} · ${texts.lvl} ${region.notable.level}</p>`
    : "";
  content.innerHTML = `<p style="margin:.2em 0">${escapeText(node.name)} · ${texts.lvl} ${node.node.level} · ${region.cells} ${texts.cells} · ${texts.fauna} ${texts.level} ${region.meanLevel.toFixed(1)}</p>
    ${notable}
    <table style="font-size:.9em;margin-bottom:.4em">${flow}<tr><td>${texts.selfSustaining}</td><td style="text-align:right">${round(self)}</td><td></td></tr></table>
    ${web(region)}`;
  Dialog.open(id, { title: `${texts.title}: ${node.name}`, width: "44em", resizable: true });
}

/** A click on a node diamond opens its ecology; other clicks are left to the generator */
document.addEventListener("click", event => {
  const target = (event.target as Element | null)?.closest?.("#artaeNodes [id^='artaeNode']");
  if (!target) return;
  showEcology(Number(target.id.replace("artaeNode", "")));
});
