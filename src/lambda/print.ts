import { type Term, VAR, LAM, APP } from "./term";

// Canonical naming: the binder at depth d is always called NAMES(d), so
// alpha-equivalent closed terms print identically and there is no shadowing.

const BASE = "xyzuvwabcdefghijklmnopqrst".split("");

export function nameAt(depth: number): string {
  const b = BASE[depth % BASE.length];
  const round = Math.floor(depth / BASE.length);
  return round === 0 ? b : b + round;
}

/**
 * Pretty-print a term with canonical names in compact binder notation,
 * e.g. `λxy.x (y y)`. Binder names are one letter plus optional digits, so
 * the run `λxyx1` is unambiguous (the parser splits it the same way).
 */
export function print(t: Term, depth = 0): string {
  switch (t.tag) {
    case VAR: {
      const binder = depth - 1 - t.idx;
      return binder >= 0 ? nameAt(binder) : `#${t.idx}`; // '#' only for open terms
    }
    case LAM: {
      const names: string[] = [];
      let body: Term = t;
      let d = depth;
      while (body.tag === LAM) {
        names.push(nameAt(d++));
        body = body.body;
      }
      return "λ" + names.join("") + "." + print(body, d);
    }
    case APP: {
      const fn = t.fn.tag === LAM ? `(${print(t.fn, depth)})` : print(t.fn, depth);
      const arg = t.arg.tag === VAR ? print(t.arg, depth) : `(${print(t.arg, depth)})`;
      return fn + " " + arg;
    }
  }
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
