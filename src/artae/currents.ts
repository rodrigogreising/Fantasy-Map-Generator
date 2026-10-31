// Artae: "currents", the routes of marine peoples. They run through water only, between marine cities, and
// reach land just at the ports of coastal realms. Shallow water is cheaper; deep ocean is fine, unlike for land ships
import { distanceSquared } from "@/utils/number-utils";

export const CURRENTS = "currents";

/** Route style for currents: dashed teal, a little wider than land searoutes */
export const CURRENTS_STYLE = {
  attrs: {
    opacity: 0.85,
    stroke: "#1fa2a2",
    "stroke-opacity": null,
    "stroke-width": 0.6,
    "stroke-dasharray": "3 1.5",
    "stroke-linecap": "round",
    "stroke-linejoin": null,
    filter: null,
    mask: null
  }
};

/** A marine city: a living burg on a water cell */
export const isMarineBurg = (burg: { i: number; cell: number; removed?: boolean }) =>
  !!burg.i && !burg.removed && pack.cells.h[burg.cell] < 20;

// depth by distance field: coast, sea, open sea, ocean; far ocean has t = 0
const DEPTH_COST: Record<string, number> = { "-1": 1, "-2": 1.15, "-3": 1.3, "-4": 1.5, default: 1.8 };

/** Cost of a current step: water only; a land cell is passable only as a port's haven exit (`haven` given) */
export function currentStepCost(current: number, next: number, connected: boolean): number {
  const { h, p, t, haven } = pack.cells;
  if (h[next] >= 20) return Infinity;
  if (h[current] >= 20) {
    const exit = haven?.[current];
    if (exit && exit !== next) return Infinity; // leave a port only through its haven
  }
  const depth = DEPTH_COST[t[next]] ?? DEPTH_COST.default;
  return distanceSquared(p[current], p[next]) * depth * (connected ? 0.5 : 1);
}
