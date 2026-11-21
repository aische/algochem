import { type Term, VAR, LAM, APP, mkVar, mkLam, mkApp, intern } from "./term";

/** Add `d` to every free index >= `cutoff`. */
export function shift(t: Term, d: number, cutoff = 0): Term {
  if (d === 0 || t.free <= cutoff) return t;
  switch (t.tag) {
    case VAR:
      return mkVar(t.idx + d);
    case LAM:
      return mkLam(shift(t.body, d, cutoff + 1));
    case APP:
      return mkApp(shift(t.fn, d, cutoff), shift(t.arg, d, cutoff));
  }
}

/**
 * Contract the redex (λ.body) arg: substitute `arg` for index `depth` in
 * `body`, lowering the indices of the remaining free variables by one.
 */
function instantiate(body: Term, arg: Term, depth: number): Term {
  if (body.free <= depth) return body;
  switch (body.tag) {
    case VAR:
      if (body.idx === depth) return shift(arg, depth);
      return mkVar(body.idx - 1); // idx > depth here, since free > depth
    case LAM:
      return mkLam(instantiate(body.body, arg, depth + 1));
    case APP:
      return mkApp(instantiate(body.fn, arg, depth), instantiate(body.arg, arg, depth));
  }
}

export function beta(body: Term, arg: Term): Term {
  return instantiate(body, arg, 0);
}

export interface ReduceLimits {
  /** Maximum number of beta steps. */
  maxSteps: number;
  /** Maximum size of any intermediate term produced by a beta step. */
  maxIntermediate: number;
  /** Maximum size of the normal form. */
  maxSize: number;
}

export const DEFAULT_LIMITS: ReduceLimits = {
  maxSteps: 1000,
  maxIntermediate: 2000,
  maxSize: 200,
};

export type ReduceResult =
  | { ok: true; term: Term; steps: number }
  | { ok: false; reason: "steps" | "size"; steps: number };

class LimitHit {
  constructor(readonly reason: "steps" | "size") {}
}

/**
 * Normal-order (leftmost-outermost) normalization: reduce to weak head normal
 * form, then normalize under the binder / along the neutral spine left to
 * right. Finds the normal form whenever one exists (within the limits).
 * The result is interned.
 */
export function normalize(t: Term, limits: ReduceLimits = DEFAULT_LIMITS): ReduceResult {
  let steps = 0;

  const step = (body: Term, arg: Term): Term => {
    if (++steps > limits.maxSteps) throw new LimitHit("steps");
    const r = beta(body, arg);
    if (r.size > limits.maxIntermediate) throw new LimitHit("size");
    return r;
  };

  const whnf = (t: Term): Term => {
    if (t.tag !== APP) return t;
    // Unwind the application spine; the last pushed arg is applied first.
    const args: Term[] = [];
    let head: Term = t;
    while (head.tag === APP) {
      args.push(head.arg);
      head = head.fn;
    }
    let reduced = false;
    while (args.length > 0 && head.tag === LAM) {
      head = step(head.body, args.pop()!);
      reduced = true;
      while (head.tag === APP) {
        args.push(head.arg);
        head = head.fn;
      }
    }
    if (!reduced) return t;
    while (args.length > 0) head = mkApp(head, args.pop()!);
    return head;
  };

  const nf = (t: Term): Term => {
    const w = whnf(t);
    switch (w.tag) {
      case VAR:
        return w;
      case LAM: {
        const b = nf(w.body);
        return b === w.body ? w : mkLam(b);
      }
      case APP: {
        // The head of the spine is a variable: normalize fn side, then argument.
        const f = nf(w.fn);
        const a = nf(w.arg);
        return f === w.fn && a === w.arg ? w : mkApp(f, a);
      }
    }
  };

  try {
    const result = nf(t);
    if (result.size > limits.maxSize) return { ok: false, reason: "size", steps };
    return { ok: true, term: intern(result), steps };
  } catch (e) {
    if (e instanceof LimitHit) return { ok: false, reason: e.reason, steps };
    if (e instanceof RangeError) return { ok: false, reason: "size", steps }; // stack overflow
    throw e;
  }
}
