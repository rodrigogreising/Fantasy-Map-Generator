// Artae: realms and provinces named after the elements of the node at their seat, from the roots
// each element has in the world profile (head + tail, see src/artae/profile.ts). Without roots, names are left as
// the generator made them
import { ELEMENTS } from "@/artae/elements";
import { cachedField, nodes } from "@/artae/nodes";
import { profile } from "@/artae/profile";
import { States } from "@/model/political/states-generator";

type Entity = { i: number; removed?: boolean; lock?: boolean; artae?: string; name?: string; formName?: string };

/** Mana share of each element over the cells of every entity, keyed by entity id */
function compositions(entityOf: ArrayLike<number>): Map<number, number[]> {
  const { cells } = pack;
  const list = nodes();
  const { owner, level } = cachedField();
  const result = new Map<number, number[]>();
  for (let cell = 0; cell < cells.i.length; cell++) {
    const id = entityOf[cell];
    if (!id) continue;
    const g = cells.g[cell];
    const node = list[owner[g]];
    if (!node) continue;
    const shares = result.get(id) ?? new Array(ELEMENTS.length).fill(0);
    result.set(id, shares);
    shares[node.node.primary] += (level[g] * 2) / 3;
    shares[node.node.secondary] += level[g] / 3;
  }
  return result;
}

const shuffled = <T>(items: T[]) =>
  items
    .map(item => [Math.random(), item] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item);

const bare = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** The same root twice, or the same letter on both sides of the joint ("Frost" + "thunder") */
const joinsBadly = (head: string, tail: string) => bare(head) === bare(tail) || bare(head).at(-1) === bare(tail)[0];

/** A full name from the profile's pattern and its form names, or the generator's own scheme */
function fullName(name: string, formName: string | undefined, generated: () => string): string {
  const { full, forms } = profile().grammar;
  if (!formName) return name;
  if (!full) return generated();
  return full.replace("{form}", forms?.[formName] ?? formName).replace("{name}", name);
}

/** Names from the strongest element's heads and the next one's tails, then the other way round and the third
 * element, skipping names already taken */
function elementalName(shares: number[], taken: Set<string>): string | undefined {
  const pattern = profile().grammar.realm ?? "{head}{tail}";
  const ranked = shares
    .map((share, e) => [share, e] as const)
    .filter(([share]) => share > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([, e]) => e);
  if (!ranked.length) return undefined;
  const [a, b = a, c = b] = ranked;
  for (const [x, y] of [
    [a, b],
    [b, a],
    [a, c],
    [a, a]
  ]) {
    const heads = profile().elements[x]?.roots?.head ?? [];
    const tails = profile().elements[y]?.roots?.tail ?? [];
    for (const head of shuffled(heads))
      for (const tail of shuffled(tails)) {
        const name = pattern.replace("{head}", head).replace("{tail}", tail);
        if (!taken.has(name) && !joinsBadly(head, tail)) return name;
      }
  }
  return undefined;
}

/** The elements of the node whose mana holds a cell: the seat a realm or district is ruled from */
function seatShares(cell: number | undefined): number[] | undefined {
  if (cell === undefined) return undefined;
  const node = nodes()[cachedField().owner[pack.cells.g[cell]]];
  if (!node) return undefined;
  const shares = new Array(ELEMENTS.length).fill(0);
  shares[node.node.primary] += 2;
  shares[node.node.secondary] += 1;
  return shares;
}

/** Each item is named after the node at its seat, or failing that after the mana of its whole territory */
function rename<T extends Entity>(
  list: T[],
  entityOf: ArrayLike<number>,
  seat: (item: T) => number | undefined,
  apply: (item: T, name: string) => void
) {
  const territory = compositions(entityOf);
  const free = (item: T) => item.i && !item.removed && !item.lock && !item.artae;
  const taken = new Set(list.filter(item => item.i && !item.removed && !free(item)).map(item => item.name ?? ""));
  for (const item of list) {
    if (!free(item)) continue;
    const shares = seatShares(seat(item)) ?? territory.get(item.i);
    const name = shares ? elementalName(shares, taken) : undefined;
    if (!name) continue;
    taken.add(name);
    apply(item, name);
  }
}

/** Realms named after the node of their capital (a realm is united under its biggest node); without a profile pattern the form keeps the generator's scheme ("Kingdom of X")
 * but never an adjective */
export function nameRealms(): void {
  rename(
    pack.states,
    pack.cells.state,
    state => pack.burgs[state.capital ?? 0]?.cell,
    (state, name) => {
      state.name = name;
      state.fullName = fullName(name, state.formName, () => {
        const full = States.getFullName(state);
        return full.startsWith(state.formName as string) ? full : `${name} ${state.formName}`;
      });
    }
  );
}

/** Provinces (node districts) named after the node at their seat */
export function nameProvinces(): void {
  rename(
    pack.provinces,
    pack.cells.province,
    province => province.center,
    (province, name) => {
      province.name = name;
      province.fullName = fullName(name, province.formName, () => `${name} ${province.formName}`);
    }
  );
}
