// Artae: find a node by its element mix, and see one element across the planet. A small box, bottom left: pick the
// primary and secondary element and the map centres on the strongest node of that pair, highlighted ("Siguiente" steps
// through the others); pick an element under "Distribución" and the map shows only that element's level everywhere,
// with the other mana and the nodes that don't hold it hidden
import { ELEMENTS } from "@/artae/elements";
import { elementLevels, findNode, nodes, type SystemNode } from "@/artae/nodes";
import { profile } from "@/artae/profile";
import { Layers } from "@/renderers/layers";
import { zoomTo } from "@/ui/map/zoom";
import { getIsolines } from "@/utils/path-utils";

const BOX_ID = "artaeNodeFinder";
const ANY = -1;
const ZOOM = 6;

const STYLE = `
#${BOX_ID} { position: fixed; left: 12px; bottom: 12px; z-index: 1000; background: rgba(22, 22, 28, 0.88); color: #eee;
  border-radius: 8px; padding: 8px 10px; font: 12px/1.3 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
#${BOX_ID} .head { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
#${BOX_ID} .body { display: grid; grid-template-columns: auto 1fr; gap: 4px 6px; margin-top: 6px; align-items: center; }
#${BOX_ID}.closed .body { display: none; }
#${BOX_ID} select, #${BOX_ID} button { font: inherit; background: #2c2c35; color: #eee; border: 1px solid #555;
  border-radius: 4px; padding: 2px 4px; }
#${BOX_ID} button { cursor: pointer; }
#${BOX_ID} .result { grid-column: 1 / 3; opacity: .8; min-height: 15px; }
#${BOX_ID} .actions { grid-column: 1 / 3; display: flex; gap: 6px; }
#${BOX_ID} hr { grid-column: 1 / 3; width: 100%; border: 0; border-top: 1px solid #444; margin: 4px 0; }
@keyframes artaeNodePulse { from { r: 4; opacity: 1; } to { r: 40; opacity: 0; } }
.artaeNodePulse { fill: none; stroke: #fff; stroke-width: 2; animation: artaeNodePulse 1.2s ease-out 3; }`;

let matches: SystemNode[] = [];
let index = 0;

function options(withAny: boolean): string {
  const any = withAny ? `<option value="${ANY}">cualquiera</option>` : "";
  return any + ELEMENTS.map((element, i) => `<option value="${i}">${element.name}</option>`).join("");
}

function box(): HTMLElement {
  const existing = document.getElementById(BOX_ID);
  if (existing) return existing;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  const element = document.createElement("div");
  element.id = BOX_ID;
  element.className = "closed";
  element.innerHTML = `<div class="head">◆ <span>Buscar nodo</span></div>
    <div class="body">
      <label>Principal</label><select data-role="primary">${options(false)}</select>
      <label>Secundario</label><select data-role="secondary">${options(true)}</select>
      <div class="actions"><button data-role="go">Ir</button><button data-role="next">Siguiente</button></div>
      <div class="result"></div>
      <hr />
      <label>Distribución</label><select data-role="filter"></select>
      <div class="result" data-role="filterResult"></div>
    </div>`;
  document.body.append(element);
  element.querySelector(".head")!.addEventListener("click", () => {
    element.classList.toggle("closed");
    if (!element.classList.contains("closed")) fillOptions(element);
  });
  element.querySelector("[data-role=go]")!.addEventListener("click", () => search(element));
  element.querySelector("[data-role=next]")!.addEventListener("click", () => show(element, index + 1));
  for (const role of ["primary", "secondary"])
    element.querySelector(`[data-role=${role}]`)!.addEventListener("change", () => search(element));
  element.querySelector("[data-role=filter]")!.addEventListener("change", () => filter(element));
  return element;
}

/** The element lists come from the setting loaded now, so they are refilled each time the box opens */
function fillOptions(element: HTMLElement): void {
  for (const [role, withAny] of [
    ["primary", false],
    ["secondary", true]
  ] as const) {
    const select = element.querySelector<HTMLSelectElement>(`[data-role=${role}]`)!;
    const kept = select.value;
    select.innerHTML = options(withAny);
    if ([...select.options].some(option => option.value === kept)) select.value = kept;
    else {
      // first open: the profile's default pair, if it names one
      const name = profile().finder?.[role === "primary" ? 0 : 1];
      const index = ELEMENTS.findIndex(e => e.name === name);
      if (index >= 0) select.value = String(index);
    }
  }
  const select = element.querySelector<HTMLSelectElement>("[data-role=filter]")!;
  const kept = select.value;
  select.innerHTML = `<option value="${ANY}">ninguno</option>${options(false)}`;
  if ([...select.options].some(option => option.value === kept)) select.value = kept;
}

const FILTER_ID = "artaeElementFilter";
const BAND_STEP = 3;
const BAND_OPACITY = [0.03, 0.18, 0.32, 0.48, 0.6, 0.7, 0.78, 0.85, 0.9, 0.93, 0.95]; // as the mana layer, a bit stronger
let filtered = ANY;

/** Show one element's level over the whole planet, or everything again with "ninguno" */
function filter(element: HTMLElement): void {
  filtered = value(element, "filter");
  const result = element.querySelector<HTMLElement>("[data-role=filterResult]")!;
  const mana = document.getElementById("elements");
  const nodeGroup = document.getElementById("artaeNodes");
  document.getElementById(FILTER_ID)?.remove();
  if (mana) mana.style.display = filtered === ANY ? "" : "none";
  for (const shape of nodeGroup?.querySelectorAll<SVGElement>("[id^=artaeNode]") ?? []) {
    const node = findNode(Number(shape.id.replace("artaeNode", "")));
    const holds = node && (node.node.primary === filtered || node.node.secondary === filtered);
    shape.style.display = filtered === ANY || holds ? "" : "none";
  }
  if (filtered === ANY) {
    result.textContent = "";
    return;
  }

  const n = grid.cells.i.length;
  const levels = new Float32Array(n);
  let top = 0;
  for (let cell = 0; cell < n; cell++) {
    levels[cell] = elementLevels(cell)[filtered];
    top = Math.max(top, levels[cell]);
  }
  const band = (level: number) => Math.min(BAND_OPACITY.length - 1, Math.floor(level / BAND_STEP));
  const graph = grid as unknown as Parameters<typeof getIsolines>[0];
  const isolines = getIsolines(graph, cell => (levels[cell] < 1 ? null : band(levels[cell])), { fill: true });
  const color = ELEMENTS[filtered].color;
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.id = FILTER_ID;
  group.innerHTML = Object.entries(isolines)
    .map(([key, { fill }]) => `<path d="${fill}" fill="${color}" fill-opacity="${BAND_OPACITY[+key]}" stroke="none" />`)
    .join("");
  const above = document.getElementById("realmBorders") ?? nodeGroup;
  above?.before(group);
  const holding = nodes().filter(({ node }) => node.primary === filtered || node.secondary === filtered).length;
  result.textContent = `${ELEMENTS[filtered].name}: ${holding} nodos · máximo nivel ${top.toFixed(1)}`;
}

const value = (element: HTMLElement, role: string) =>
  Number(element.querySelector<HTMLSelectElement>(`[data-role=${role}]`)!.value);

function search(element: HTMLElement): void {
  const primary = value(element, "primary");
  const secondary = value(element, "secondary");
  matches = nodes()
    .filter(({ node }) => node.primary === primary && (secondary === ANY || node.secondary === secondary))
    .sort((a, b) => b.node.level - a.node.level);
  show(element, 0);
}

function show(element: HTMLElement, at: number): void {
  const result = element.querySelector<HTMLElement>(".result")!;
  if (!matches.length) {
    result.textContent = nodes().length ? "No hay nodos de esa mezcla" : "Este mapa no tiene nodos";
    return;
  }
  index = ((at % matches.length) + matches.length) % matches.length;
  const node = matches[index];
  result.textContent = `${node.name} · nivel ${node.node.level} (${index + 1} de ${matches.length})`;
  if (!Layers.isOn("nodes")) Layers.show("nodes");
  zoomTo(node.x, node.y, ZOOM, 1500);
  pulse(node);
}

/** A ring that ripples out from the node a few times */
function pulse({ x, y }: SystemNode): void {
  const group = document.getElementById("artaeNodes");
  if (!group) return;
  group.querySelector(".artaeNodePulse")?.remove();
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  ring.setAttribute("class", "artaeNodePulse");
  ring.setAttribute("cx", String(x));
  ring.setAttribute("cy", String(y));
  ring.setAttribute("r", "4");
  group.append(ring);
  ring.addEventListener("animationend", () => ring.remove());
}

/** Add the finder to the page, closed */
export function mountNodeFinder(): void {
  box();
}
