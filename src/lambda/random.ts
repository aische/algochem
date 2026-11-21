import { type Term, mkVar, mkLam, mkApp, intern } from "./term";
import { normalize, DEFAULT_LIMITS, type ReduceLimits } from "./reduce";
import type { Rng } from "../rng";

/** Probability of choosing an abstraction (vs. application) when both fit. */
const P_LAM = 0.35;

/**
 * Random term of exactly `size` nodes (Var = 1, Lam = 1 + body,
 * App = 1 + fn + arg) whose free indices are all < `depth`.
 * With depth 0 the result is closed.
 */
function gen(rng: Rng, size: number, depth: number): Term {
  if (size === 1) return mkVar(rng.int(0, depth - 1)); // only reached with depth > 0
  if (depth === 0 || size === 2 || rng.chance(P_LAM)) {
    return mkLam(gen(rng, size - 1, depth + 1));
  }
  // App: split the remaining size-1 nodes between fn and arg (each >= 1).
  const k = rng.int(1, size - 2);
  return mkApp(gen(rng, k, depth), gen(rng, size - 1 - k, depth));
}

/** Random closed term with size uniformly in [minSize, maxSize]. Interned. */
export function randomClosedTerm(rng: Rng, minSize: number, maxSize: number): Term {
  const size = rng.int(Math.max(2, minSize), Math.max(2, maxSize));
  return intern(gen(rng, size, 0));
}

const NORMAL_TRIES = 64;

/**
 * Random closed term in normal form with size in [minSize, maxSize]:
 * a random term, normalized within `limits`. Terms without a normal form
 * (within the limits) or whose normal form falls outside the size range are
 * drawn again. Interned.
 */
export function randomNormalTerm(rng: Rng, minSize: number, maxSize: number, limits: ReduceLimits = DEFAULT_LIMITS): Term {
  const lo = Math.max(2, minSize);
  const hi = Math.max(lo, maxSize);
  for (let i = 0; i < NORMAL_TRIES; i++) {
    const r = normalize(gen(rng, rng.int(lo, hi), 0), limits);
    if (r.ok && r.term.size >= lo && r.term.size <= hi) return r.term;
  }
  // Practically unreachable; a projection λ…λ.x is always in normal form.
  let t: Term = mkVar(0);
  for (let s = rng.int(lo, hi); s > 1; s--) t = mkLam(t);
  return intern(t);
}
