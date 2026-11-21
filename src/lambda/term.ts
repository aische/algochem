// Lambda terms in de Bruijn notation.
//
// Every node caches its `size` (node count) and `free`: the smallest k such
// that every free index is < k. A closed term has free === 0. `free` lets
// shift/substitution skip whole subtrees that cannot be affected.
//
// Reduction builds plain (non-interned) nodes for speed. `intern` turns a term
// into its canonical hash-consed representative, after which structural
// equality is `===` and `id` is a stable species identifier.

export const VAR = 0;
export const LAM = 1;
export const APP = 2;

export interface Var {
  readonly tag: typeof VAR;
  readonly idx: number;
  readonly size: number;
  readonly free: number;
  id: number;
}

export interface Lam {
  readonly tag: typeof LAM;
  readonly body: Term;
  readonly size: number;
  readonly free: number;
  id: number;
}

export interface App {
  readonly tag: typeof APP;
  readonly fn: Term;
  readonly arg: Term;
  readonly size: number;
  readonly free: number;
  id: number;
}

export type Term = Var | Lam | App;

export function mkVar(idx: number): Var {
  return { tag: VAR, idx, size: 1, free: idx + 1, id: 0 };
}

export function mkLam(body: Term): Lam {
  return { tag: LAM, body, size: body.size + 1, free: body.free > 0 ? body.free - 1 : 0, id: 0 };
}

export function mkApp(fn: Term, arg: Term): App {
  return {
    tag: APP,
    fn,
    arg,
    size: fn.size + arg.size + 1,
    free: fn.free > arg.free ? fn.free : arg.free,
    id: 0,
  };
}

export const isClosed = (t: Term): boolean => t.free === 0;

// ---------------------------------------------------------------------------
// Hash-consing

let table = new Map<string, Term>();
let nextId = 1;

function keyOf(t: Term): string {
  switch (t.tag) {
    case VAR:
      return "v" + t.idx;
    case LAM:
      return "l" + t.body.id;
    case APP:
      return "a" + t.fn.id + "," + t.arg.id;
  }
}

/** Return the canonical representative of `t`. Children are interned first. */
export function intern(t: Term): Term {
  if (t.id !== 0) return t;
  let node: Term;
  switch (t.tag) {
    case VAR:
      node = t;
      break;
    case LAM: {
      const body = intern(t.body);
      node = body === t.body ? t : mkLam(body);
      break;
    }
    case APP: {
      const fn = intern(t.fn);
      const arg = intern(t.arg);
      node = fn === t.fn && arg === t.arg ? t : mkApp(fn, arg);
      break;
    }
  }
  const key = keyOf(node);
  const existing = table.get(key);
  if (existing) return existing;
  node.id = nextId++;
  table.set(key, node);
  return node;
}

export function internTableSize(): number {
  return table.size;
}

/**
 * Drop every interned node not reachable from `roots`. Ids of surviving nodes
 * are preserved. Callers must not keep references to interned terms outside
 * `roots` across a collection (they would stop being canonical).
 */
export function collectGarbage(roots: Iterable<Term>): void {
  const fresh = new Map<string, Term>();
  const visit = (t: Term): void => {
    if (t.id === 0) return;
    const key = keyOf(t);
    if (fresh.has(key)) return;
    fresh.set(key, t);
    if (t.tag === LAM) visit(t.body);
    else if (t.tag === APP) {
      visit(t.fn);
      visit(t.arg);
    }
  };
  for (const r of roots) visit(r);
  table = fresh;
}
