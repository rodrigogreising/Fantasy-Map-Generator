// Artae: "currents", the routes of marine peoples. They run through water only, between marine cities, and
// reach land just at the ports of coastal realms. Shallow water is cheaper; deep ocean is fine, unlike for land ships
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

/** The cost of a current step, built once per generation (a search calls it hundreds of thousands of times): water
 * only; a land cell is passable only as a port's haven exit. `connected` says whether a current already runs there */
export function currentCosts(connected: (current: number, next: number) => boolean) {
  const { h, p, t, haven } = pack.cells;
  const n = h.length;
  const depth = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let cell = 0; cell < n; cell++) {
    depth[cell] = DEPTH_COST[t[cell]] ?? DEPTH_COST.default;
    [x[cell], y[cell]] = p[cell];
  }
  return (current: number, next: number): number => {
    if (h[next] >= 20) return Infinity;
    if (h[current] >= 20) {
      const exit = haven?.[current];
      if (exit && exit !== next) return Infinity; // leave a port only through its haven
    }
    const dx = x[current] - x[next];
    const dy = y[current] - y[next];
    return (dx * dx + dy * dy) * depth[next] * (connected(current, next) ? 0.5 : 1);
  };
}
