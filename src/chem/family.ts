import { type Term, VAR, LAM, mkVar, mkLam, mkApp } from "../lambda/term";
import { print } from "../lambda/print";

// A family groups species that differ only in unused leading binders.
// Applying `λxy.x` to T gives `λy.T`: T with one more binder that nothing
// uses. Reactions like this produce long runs of shifted variants of the same
// expression, e.g. `λxyzu.x (x (λv.x))` and `λxyzuv.y (y (λw.y))`. Dropping
// the unused leading binders maps both to `λx.x (x (λy.x))`. All projections
// (`λxy.x`, `λxyz.y`, …) are one family: `λx.x`.

/**
 * The term with its unused leading binders removed. The used ones keep their
 * order. Not interned (family representatives need not be in the soup).
 */
export function familyTerm(t: Term): Term {
  let n = 0;
  let body = t;
  while (body.tag === LAM) {
    n++;
    body = body.body;
  }
  if (n === 0) return t;
  // used[j]: leading binder j (0 = outermost) occurs in the body.
  const used = new Array<boolean>(n).fill(false);
  const mark = (u: Term, d: number): void => {
    if (u.free <= d) return;
    if (u.tag === VAR) used[n - 1 - (u.idx - d)] = true;
    else if (u.tag === LAM) mark(u.body, d + 1);
    else {
      mark(u.fn, d);
      mark(u.arg, d);
    }
  };
  mark(body, 0);
  const pos: number[] = [];
  let k = 0;
  for (let j = 0; j < n; j++) pos.push(used[j] ? k++ : -1);
  if (k === n) return t;

  const remap = (u: Term, d: number): Term => {
    if (u.free <= d) return u;
    switch (u.tag) {
      case VAR:
        return mkVar(d + k - 1 - pos[n - 1 - (u.idx - d)]);
      case LAM:
        return mkLam(remap(u.body, d + 1));
      default:
        return mkApp(remap(u.fn, d), remap(u.arg, d));
    }
  };
  let out = remap(body, 0);
  for (let i = 0; i < k; i++) out = mkLam(out);
  return out;
}

// Species id → family key. Ids are never reused, so entries never go stale.
const cache = new Map<number, string>();
const CACHE_MAX = 100_000;

/** Family identifier: the printed family term. Cached per species. */
export function familyKey(t: Term): string {
  let key = t.id ? cache.get(t.id) : undefined;
  if (key === undefined) {
    key = print(familyTerm(t));
    if (t.id) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(t.id, key);
    }
  }
  return key;
}

export interface FamilyInfo {
  key: string;
  /** The family's expression (unused leading binders removed). */
  term: Term;
  /** Molecules in the soup. */
  count: number;
  /** Distinct species in the soup. */
  species: number;
  /** Earliest first-seen time among its species. */
  firstSeen: number;
}

/** Group a species summary into families. */
export function familySummary(species: Iterable<{ term: Term; count: number; firstSeen?: number }>): FamilyInfo[] {
  const byKey = new Map<string, FamilyInfo>();
  for (const s of species) {
    const key = familyKey(s.term);
    const f = byKey.get(key);
    const seen = s.firstSeen ?? 0;
    if (f) {
      f.count += s.count;
      f.species++;
      f.firstSeen = Math.min(f.firstSeen, seen);
    } else byKey.set(key, { key, term: familyTerm(s.term), count: s.count, species: 1, firstSeen: seen });
  }
  return [...byKey.values()];
}
