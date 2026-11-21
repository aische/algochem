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

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join("");

/**
 * Indices (relative to `t`'s own scope) of the variables `t` uses from the
 * `n` binders directly around it: index 0 is the innermost of those binders.
 */
function usedOuter(t: Term, n: number): boolean[] {
  const used = new Array<boolean>(n).fill(false);
  const visit = (u: Term, d: number): void => {
    if (u.free <= d) return;
    if (u.tag === VAR) {
      const k = u.idx - d;
      if (k < n) used[k] = true;
    } else if (u.tag === LAM) visit(u.body, d + 1);
    else {
      visit(u.fn, d);
      visit(u.arg, d);
    }
  };
  visit(t, 0);
  return used;
}

/**
 * Compact form for display: unused binders print as `_` (a run of n as
 * `_ⁿ`), and only used binders get names, so a term with a long run of
 * unused binders stays short: `λxyzuv.u (λwa.z)` → `λ_²xy_.y (λ_².x)`.
 * Not parseable; `print` is the full form.
 */
export function printCompact(t: Term): string {
  // names[i]: the name of the binder i levels out (innermost last), or null if unused.
  const names: (string | null)[] = [];
  let named = 0;
  const go = (t: Term): string => {
    switch (t.tag) {
      case VAR:
        return names[names.length - 1 - t.idx] ?? `#${t.idx}`;
      case LAM: {
        let body: Term = t;
        let n = 0;
        while (body.tag === LAM) {
          n++;
          body = body.body;
        }
        const used = usedOuter(body, n);
        let head = "";
        let gap = 0;
        const flush = () => {
          if (gap > 0) head += gap === 1 ? "_" : "_" + sup(gap);
          gap = 0;
        };
        const before = named;
        for (let i = 0; i < n; i++) {
          if (used[n - 1 - i]) {
            flush();
            const name = nameAt(named++);
            names.push(name);
            head += name;
          } else {
            gap++;
            names.push(null);
          }
        }
        flush();
        const s = "λ" + head + "." + go(body);
        names.length -= n;
        named = before;
        return s;
      }
      case APP: {
        const fn = t.fn.tag === LAM ? `(${go(t.fn)})` : go(t.fn);
        const arg = t.arg.tag === VAR ? go(t.arg) : `(${go(t.arg)})`;
        return fn + " " + arg;
      }
    }
  };
  return go(t);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
