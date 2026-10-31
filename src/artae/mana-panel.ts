// Artae: a fixed panel, top right, that shows the mana under the pointer at a glance: a big level number and coloured
// bars for the local element mix, plus the dominant node and the realm. Shown while the Mana or Fronteras layer is on
import { ELEMENTS } from "@/artae/elements";
import { nodeRealmSuffix, realms } from "@/artae/geopolitics";
import { cachedField, elementLevels, findNode, nodes } from "@/artae/nodes";

const PANEL_ID = "artaeManaPanel";
const BARS = 6;
const FULL = 30; // a bar is full at this level

const STYLE = `
#${PANEL_ID} { position: fixed; top: 12px; right: 12px; width: 230px; z-index: 1000; pointer-events: none;
  background: rgba(22, 22, 28, 0.88); color: #eee; border-radius: 8px; padding: 10px 12px 12px;
  font: 12px/1.3 system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,.35); }
#${PANEL_ID} .realm { font-size: 11px; opacity: .75; text-transform: uppercase; letter-spacing: .04em; min-height: 14px; }
#${PANEL_ID} .level { display: flex; align-items: baseline; gap: 6px; margin: 2px 0 8px; }
#${PANEL_ID} .level b { font-size: 30px; font-weight: 600; line-height: 1; }
#${PANEL_ID} .level span { opacity: .7; }
#${PANEL_ID} .row { display: grid; grid-template-columns: 74px 1fr 32px; align-items: center; gap: 6px; margin: 3px 0; }
#${PANEL_ID} .track { height: 9px; background: rgba(255,255,255,.12); border-radius: 5px; overflow: hidden; }
#${PANEL_ID} .fill { height: 100%; border-radius: 5px; }
#${PANEL_ID} .pct { text-align: right; opacity: .85; font-variant-numeric: tabular-nums; }
#${PANEL_ID} .foot { margin-top: 8px; font-size: 11px; opacity: .7; }`;

function panel(): HTMLElement {
  let element = document.getElementById(PANEL_ID);
  if (element) return element;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);
  element = document.createElement("div");
  element.id = PANEL_ID;
  document.body.append(element);
  return element;
}

const escapeText = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

/** One bar per element, its length and number the element's level there */
function bars(levels: { element: number; level: number }[]): string {
  return levels
    .slice(0, BARS)
    .filter(({ level }) => level >= 0.05)
    .map(({ element, level }) => {
      const { name, color } = ELEMENTS[element];
      const width = Math.max(2, Math.min(100, (level / FULL) * 100));
      return `<div class="row"><span>${name}</span><div class="track"><div class="fill" style="width:${width}%;background:${color}"></div></div><span class="pct">${level.toFixed(1)}</span></div>`;
    })
    .join("");
}

function render(
  realm: string,
  level: number,
  label: string,
  levels: { element: number; level: number }[],
  foot: string
) {
  const element = panel();
  element.innerHTML = `<div class="realm">${escapeText(realm)}</div>
    <div class="level"><b>${level.toFixed(1)}</b><span>${label}</span></div>
    ${bars(levels)}
    <div class="foot">${escapeText(foot)}</div>`;
  element.style.display = "block";
}

/** The mana at a map cell; `nodeId` when the pointer is on a node, which then shows that node instead */
export function updateManaPanel(cellId: number, gridCell: number, nodeId?: number): void {
  if (!nodes().length) {
    hideManaPanel();
    return;
  }
  const node = nodeId === undefined ? undefined : findNode(nodeId);
  if (node) {
    const { primary, secondary, level } = node.node;
    const mix =
      primary === secondary
        ? [{ element: primary, level }]
        : [
            { element: primary, level: (level * 2) / 3 },
            { element: secondary, level: level / 3 }
          ];
    const realm = nodeRealmSuffix(node.i).replace(/^ · /, "");
    render(realm || "Sin reino", level, "nivel del nodo", mix, node.name);
    return;
  }
  const { owner, level } = cachedField();
  const dominant = nodes()[owner[gridCell]];
  const realm = realms().get(pack.cells.state[cellId]);
  const realmText = realm ? `${realm.name} · ${realm.nodes.length} nodos` : "Sin reino";
  const foot = dominant ? `Domina: ${dominant.name} · nivel ${dominant.node.level}` : "";
  const levels = elementLevels(gridCell)
    .map((value, element) => ({ element, level: value }))
    .sort((a, b) => b.level - a.level);
  render(realmText, level[gridCell], "nivel de mana", levels, foot);
}

export function hideManaPanel(): void {
  const element = document.getElementById(PANEL_ID);
  if (element) element.style.display = "none";
}
