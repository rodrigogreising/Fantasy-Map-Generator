// Artae: the "Instituciones" section of the burg editor: the town's local element levels and the institutions that
// keep a seat there, grouped by kind, with their tint
import { ELEMENTS } from "@/artae/elements";
import { KINDS, loadCanonInstitutions, TINTS, townInstitutions } from "@/artae/institutions";
import { nodes } from "@/artae/nodes";

const LEVELS_SHOWN = 6;
const escapeText = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);

function levelBars(levels: number[]): string {
  const top = levels
    .map((level, element) => ({ element, level }))
    .sort((a, b) => b.level - a.level)
    .slice(0, LEVELS_SHOWN)
    .filter(({ level }) => level > 0);
  const max = top[0]?.level || 1;
  return top
    .map(({ element, level }) => {
      const { name, color } = ELEMENTS[element];
      return `<div style="display:grid;grid-template-columns:6.5em 1fr 2.5em;gap:.4em;align-items:center;margin:.15em 0">
        <span>${name}</span>
        <div style="height:.6em;background:#0001;border-radius:.3em;overflow:hidden"><div style="height:100%;width:${(level / max) * 100}%;background:${color}"></div></div>
        <span style="text-align:right;font-variant-numeric:tabular-nums">${level.toFixed(1)}</span></div>`;
    })
    .join("");
}

function institutionsHtml(burgId: number): string {
  if (!nodes().length) return "<p style='margin:.3em 0'>No hay nodos en este mapa.</p>";
  const { levels, institutions } = townInstitutions(burgId);
  const groups = KINDS.map(kind => {
    const members = institutions.filter(item => item.kind === kind.id);
    if (!members.length) return "";
    const rows = members
      .map(item => {
        const tint = TINTS[item.tint];
        const pair =
          item.primary === item.secondary
            ? ELEMENTS[item.primary].name
            : `${ELEMENTS[item.primary].name} + ${ELEMENTS[item.secondary].name}`;
        const name = item.canon
          ? `<a href="/artae/canon/${item.canon}" target="_blank">${escapeText(item.name)}</a>`
          : escapeText(item.name);
        return `<li style="margin:.35em 0;list-style:none">
          <span title="${item.tint}: ${tint.strategy}" style="display:inline-block;padding:0 .4em;border-radius:.6em;background:${tint.color};color:#fff;font-size:.8em">${item.tint}</span>
          <b>${name}</b> <span style="opacity:.7;font-size:.85em">${pair} · ${item.strength}</span>
          <div style="font-size:.85em;opacity:.85;margin-left:.2em">${escapeText(item.purpose)}</div></li>`;
      })
      .join("");
    return `<div style="font-weight:bold;margin:.5em 0 .1em">${kind.label}</div><ul style="margin:0;padding:0">${rows}</ul>`;
  }).join("");
  return `<div style="font-weight:bold;margin:.3em 0 .1em">Niveles locales</div>${levelBars(levels)}${groups}`;
}

/** Fill a burg editor section with the town's institutions; canon examples load first, once */
export async function renderTownInstitutions(container: HTMLElement, burgId: number): Promise<void> {
  const burg = pack.burgs[burgId];
  if (!burg?.i || burg.removed) {
    container.innerHTML = "";
    return;
  }
  await loadCanonInstitutions();
  if (Number(container.dataset.burg) !== burgId) return; // the editor moved on to another burg meanwhile
  container.innerHTML = institutionsHtml(burgId);
}
