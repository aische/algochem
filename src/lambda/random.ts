import { type Term, mkVar, mkLam, mkApp, intern } from "./term";
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
