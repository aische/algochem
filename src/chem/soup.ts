import { type Term, mkApp, collectGarbage, internTableSize } from "../lambda/term";
import { normalize, type ReduceLimits, DEFAULT_LIMITS } from "../lambda/reduce";
import { randomClosedTerm } from "../lambda/random";
import type { Rng } from "../rng";

export interface ChemConfig {
  limits: ReduceLimits;
  /** Forbid reactions whose product equals one of the reactants. */
  blockCopies: boolean;
  initMinSize: number;
  initMaxSize: number;
}

export const DEFAULT_CHEM: ChemConfig = {
  limits: DEFAULT_LIMITS,
  blockCopies: true,
  initMinSize: 3,
  initMaxSize: 12,
};

export interface ReactorStats {
  attempts: number;
  products: number;
  failedLimit: number;
  blockedCopy: number;
}

const CACHE_LIMIT = 200_000;
const GC_THRESHOLD = 300_000;

/**
 * AlChemy reaction rule: A + B → normalize(A B). Results are memoized by
 * reactant species, since organizations replay the same reactions constantly.
 */
export class Reactor {
  readonly stats: ReactorStats = { attempts: 0, products: 0, failedLimit: 0, blockedCopy: 0 };
  private cache = new Map<string, Term | null>();

  constructor(readonly cfg: ChemConfig = DEFAULT_CHEM) {}

  /** Product of applying `a` to `b`, or null if the reaction is elastic. */
  react(a: Term, b: Term): Term | null {
    this.stats.attempts++;
    const key = a.id + ":" + b.id;
    let product = this.cache.get(key);
    if (product === undefined) {
      product = this.compute(a, b);
      if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
      this.cache.set(key, product);
    }
    if (product) this.stats.products++;
    return product;
  }

  private compute(a: Term, b: Term): Term | null {
    const r = normalize(mkApp(a, b), this.cfg.limits);
    if (!r.ok) {
      this.stats.failedLimit++;
      return null;
    }
    if (r.term.free !== 0) return null; // cannot happen for closed reactants
    if (this.cfg.blockCopies && (r.term === a || r.term === b)) {
      this.stats.blockedCopy++;
      return null;
    }
    return r.term;
  }

  /**
   * Free interned terms no longer in the soup. Call between frames with every
   * live molecule; the reaction cache is dropped since it holds terms too.
   */
  maybeCollect(live: Iterable<Term>): boolean {
    if (internTableSize() < GC_THRESHOLD) return false;
    this.cache.clear();
    collectGarbage(live);
    return true;
  }
}

export function randomSoup(rng: Rng, n: number, cfg: ChemConfig = DEFAULT_CHEM): Term[] {
  const out: Term[] = [];
  for (let i = 0; i < n; i++) out.push(randomClosedTerm(rng, cfg.initMinSize, cfg.initMaxSize));
  return out;
}

/**
 * Spatially well-mixed soup (no physics): pick two random molecules, react,
 * add the product, remove a random molecule. Used for headless tests and as
 * a reference for the visual simulation.
 */
export class WellMixedSoup {
  readonly molecules: Term[];
  readonly reactor: Reactor;

  constructor(
    private rng: Rng,
    n: number,
    cfg: ChemConfig = DEFAULT_CHEM,
  ) {
    this.molecules = randomSoup(rng, n, cfg);
    this.reactor = new Reactor(cfg);
  }

  /** One collision. Returns the product, if any. */
  step(): Term | null {
    const m = this.molecules;
    const a = m[this.rng.int(0, m.length - 1)];
    const b = m[this.rng.int(0, m.length - 1)];
    const p = this.reactor.react(a, b);
    if (p) {
      m[this.rng.int(0, m.length - 1)] = p; // dilution keeps N constant
    }
    return p;
  }

  speciesCounts(): Map<number, { term: Term; count: number }> {
    const counts = new Map<number, { term: Term; count: number }>();
    for (const t of this.molecules) {
      const e = counts.get(t.id);
      if (e) e.count++;
      else counts.set(t.id, { term: t, count: 1 });
    }
    return counts;
  }
}
