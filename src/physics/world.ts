import type { Term } from "../lambda/term";
import type { Reactor } from "../chem/soup";
import { randomNormalTerm } from "../lambda/random";
import type { Rng } from "../rng";

/**
 * catalytic:   A + B → A + B + C, then a nearby molecule is diluted away
 *              (classic AlChemy; population constant).
 * consumptive: A + B → C; both reactants are used up. With inflow, fresh
 *              random molecules top the soup back up; without, it shrinks.
 */
export type ReactionMode = "catalytic" | "consumptive";

/** What inflow restores: the initial molecule count, or the initial soup mass. */
export type RefillBy = "count" | "mass";

export interface Particle {
  term: Term;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  /** Seconds until this molecule may react again. */
  cooldown: number;
  /** Seconds since creation (drives the fade-in glow). */
  age: number;
  /** -1 while alive; otherwise seconds since it started dissolving. */
  dying: number;
  /** Reaction product (glows when new), as opposed to initial or inflow. */
  product: boolean;
  /** Consumed reactant: where it is being drawn into (in its own frame). */
  merge: { x: number; y: number } | null;
}

export interface WorldConfig {
  /** Brownian noise strength (px/s per sqrt(s)). */
  brownian: number;
  /** Linear damping rate (1/s). */
  damping: number;
  /** Probability that a fresh contact attempts a reaction. */
  pReact: number;
  /** Seconds a molecule is inert after a contact. */
  cooldown: number;
  /** Max reaction attempts per sim step. */
  reactionBudget: number;
  /** Seconds a diluted molecule takes to fade out. */
  dissolveTime: number;
  /** Radius within which a reaction's product displaces a molecule (px). */
  dilutionRadius: number;
  /** Seconds a consumed reactant takes to merge into its product. */
  mergeTime: number;
  /** Max fresh molecules added per step while inflow refills the soup. */
  inflowPerStep: number;
  /** Free mass at start, as a fraction of the initial soup's mass. */
  initialPoolFraction: number;
  /** Refilling by mass: molecule count is capped at this × the initial count. */
  maxPopulationFactor: number;
  /** Broad-phase grid cell size (px). Wide, short cells suit text labels. */
  cellW: number;
  cellH: number;
}

export const DEFAULT_WORLD: WorldConfig = {
  brownian: 22,
  damping: 0.6,
  pReact: 0.35,
  cooldown: 0.6,
  reactionBudget: 20,
  dissolveTime: 0.25,
  dilutionRadius: 120,
  mergeTime: 0.35,
  inflowPerStep: 6,
  initialPoolFraction: 0.2,
  maxPopulationFactor: 2,
  cellW: 128,
  cellH: 32,
};

export interface ReactionEvent {
  x: number;
  y: number;
  product: Particle;
}

export interface Stir {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  strength: number;
}

export interface SpeciesInfo {
  term: Term;
  count: number;
  /** Sim time (s) the species (re)appeared. */
  firstSeen: number;
}

export type Measure = (t: Term) => { w: number; h: number };

export class World {
  particles: Particle[] = [];
  /** Simulated seconds since the world was created. */
  time = 0;
  mode: ReactionMode = "catalytic";
  /** Consumptive mode only: refill the soup to `target` with random molecules. */
  inflow = true;
  /** Population inflow refills to (the initial size). */
  target = 0;
  refillBy: RefillBy = "count";
  /** Soup mass inflow refills to when refilling by mass (the initial mass). */
  targetMass = 0;
  /**
   * Conserve mass (AST node count). Soup mass + `pool` stays constant:
   * reactions that shrink terms free nodes into the pool, reactions that grow
   * them must draw from it (or fail), and inflow is built from it.
   */
  conserve = false;
  /** Free mass (nodes) not bound in any molecule. */
  pool = 0;
  /** Reactions refused because the pool could not pay for them. */
  starved = 0;
  /** Sim time at which each live species (term id) first appeared. */
  private firstSeen = new Map<number, number>();
  stir: Stir | null = null;
  /**
   * Multiplies the Brownian kick. Molecules move `mixing` times faster and
   * spread `mixing²` times faster: low values let separate regions evolve
   * their own organizations, high values approach a well-mixed soup.
   */
  mixing = 1;
  /**
   * A wall down the middle (x = width/2) and at the x = 0 seam splits the
   * soup into two halves that cannot meet: no molecule crosses, nothing
   * collides across, and dilution stays on its own side.
   */
  wall = false;

  // Toroidal broad-phase grid. Cell sizes divide the world exactly so cell
  // indices wrap the same way positions do.
  private grid: number[][] = [];
  private cols = 0;
  private rows = 0;
  private csx = 1;
  private csy = 1;

  constructor(
    public width: number,
    public height: number,
    private rng: Rng,
    private reactor: Reactor,
    private measure: Measure,
    readonly cfg: WorldConfig = DEFAULT_WORLD,
  ) {}

  populate(terms: Term[]): void {
    this.wall = false;
    this.setInitial(terms);
    this.particles = terms.map((term) => {
      const p = this.spawnRandomly(term);
      p.age = 10; // initial molecules appear without fading in
      return p;
    });
  }

  /** Two soups side by side, `left` and `right`, with the wall up between them. */
  populateSplit(left: Term[], right: Term[]): void {
    this.setInitial([...left, ...right]);
    this.wall = true;
    const half = this.width / 2;
    const place = (term: Term, x0: number): Particle => {
      const p = this.spawnRandomly(term);
      p.x = x0 + this.rng.next() * half;
      p.age = 10;
      this.confine(p, x0 === 0);
      return p;
    };
    this.particles = [...left.map((t) => place(t, 0)), ...right.map((t) => place(t, half))];
  }

  private setInitial(terms: Term[]): void {
    this.target = terms.length;
    const mass = terms.reduce((m, t) => m + t.size, 0);
    this.targetMass = mass;
    this.pool = Math.round(mass * this.cfg.initialPoolFraction);
  }

  /**
   * Add molecules around (x, y). Catalytic mode keeps the count: each one
   * displaces a nearby molecule, like a product does. With conservation on,
   * each is paid for from the pool; dropping stops when the pool runs dry.
   * Returns how many were added.
   */
  drop(terms: Term[], x: number, y: number): number {
    const added: Particle[] = [];
    for (const term of terms) {
      const px = mod(x + this.rng.gauss() * 30, this.width);
      const py = mod(y + this.rng.gauss() * 20, this.height);
      const victim = this.mode === "catalytic" ? this.pickNear(px, py) : null;
      if (this.conserve) {
        const cost = term.size - (victim ? victim.term.size : 0);
        if (cost > this.pool) break;
        this.pool -= cost;
      }
      if (victim) victim.dying = 0;
      const p = this.spawn(term, px, py);
      const speed = this.thermalSpeed();
      p.vx = this.rng.gauss() * speed;
      p.vy = this.rng.gauss() * speed;
      p.product = true; // glows like a fresh product
      p.cooldown = this.cfg.cooldown;
      if (this.wall) this.confine(p, px < this.width / 2);
      added.push(p);
    }
    for (const p of added) this.particles.push(p);
    return added.length;
  }

  /** Recompute every label box, e.g. after the label style changed. */
  remeasure(): void {
    for (const p of this.particles) {
      const { w, h } = this.measure(p.term);
      p.w = w;
      p.h = h;
    }
  }

  /** 0..1 progress of a dissolving or merging molecule. */
  dyingProgress(p: Particle): number {
    if (p.dying < 0) return 0;
    return Math.min(1, p.dying / (p.merge ? this.cfg.mergeTime : this.cfg.dissolveTime));
  }

  /** Change the world size, scaling positions so the soup expands/contracts. */
  resize(width: number, height: number): void {
    const sx = width / this.width;
    const sy = height / this.height;
    for (const p of this.particles) {
      p.x = Math.min(p.x * sx, width - 1e-6);
      p.y = Math.min(p.y * sy, height - 1e-6);
    }
    this.width = width;
    this.height = height;
  }

  /** Fraction of the world area covered by molecule labels. */
  coverage(): number {
    let a = 0;
    for (const p of this.particles) if (p.dying < 0) a += p.w * p.h;
    return a / (this.width * this.height);
  }

  /**
   * One entry per live species. Also forgets first-seen times of extinct
   * species, so a species that dies out and re-forms counts as new again.
   */
  speciesSummary(): SpeciesInfo[] {
    const byId = new Map<number, SpeciesInfo>();
    for (const p of this.particles) {
      if (p.dying >= 0) continue;
      const e = byId.get(p.term.id);
      if (e) e.count++;
      else byId.set(p.term.id, { term: p.term, count: 1, firstSeen: this.firstSeen.get(p.term.id) ?? 0 });
    }
    for (const id of this.firstSeen.keys()) if (!byId.has(id)) this.firstSeen.delete(id);
    return [...byId.values()];
  }

  /** Mass (total AST nodes) bound in live molecules. */
  soupMass(): number {
    let m = 0;
    for (const p of this.particles) if (p.dying < 0) m += p.term.size;
    return m;
  }

  aliveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.dying < 0) n++;
    return n;
  }

  *liveTerms(): Iterable<Term> {
    for (const p of this.particles) yield p.term;
  }

  /** Particle whose box contains (x, y), topmost first. */
  pick(x: number, y: number): Particle | null {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.dying >= 0) continue;
      const dx = Math.abs(x - p.x);
      const dy = Math.abs(y - p.y);
      const hx = Math.min(dx, this.width - dx);
      const hy = Math.min(dy, this.height - dy);
      if (hx <= p.w / 2 && hy <= p.h / 2) return p;
    }
    return null;
  }

  step(dt: number, events: ReactionEvent[]): void {
    this.time += dt;
    this.integrate(dt);
    this.collide(events);
    if (this.mode === "consumptive" && this.inflow) this.flowIn();
    this.reap(dt);
  }

  // -------------------------------------------------------------------------

  private spawn(term: Term, x: number, y: number): Particle {
    if (!this.firstSeen.has(term.id)) {
      this.firstSeen.set(term.id, this.time);
      if (this.firstSeen.size > 8 * this.particles.length + 1000) this.speciesSummary(); // prune
    }
    const { w, h } = this.measure(term);
    return { term, x, y, vx: 0, vy: 0, w, h, cooldown: 0, age: 0, dying: -1, product: false, merge: null };
  }

  /** New molecule at a random position with a thermal velocity. */
  private spawnRandomly(term: Term): Particle {
    const p = this.spawn(term, this.rng.next() * this.width, this.rng.next() * this.height);
    if (this.wall) this.confine(p, p.x < this.width / 2);
    const speed = this.thermalSpeed();
    p.vx = this.rng.gauss() * speed;
    p.vy = this.rng.gauss() * speed;
    return p;
  }

  /** Typical speed (px/s per axis) of a molecule at the current mixing. */
  private thermalSpeed(): number {
    return (this.cfg.brownian * this.mixing) / Math.sqrt(2 * this.cfg.damping);
  }

  /**
   * Keep a molecule's whole box inside its half while the wall is up, so it
   * can neither cross nor touch a molecule on the other side.
   */
  private confine(p: Particle, left: boolean): void {
    const half = this.width / 2;
    const lo = left ? 0 : half;
    const hi = left ? half : this.width;
    const m = Math.min(p.w / 2, half / 2);
    if (p.x < lo + m) {
      p.x = lo + m;
      p.vx = Math.abs(p.vx);
    } else if (p.x > hi - m) {
      p.x = hi - m;
      p.vx = -Math.abs(p.vx);
    }
  }

  /**
   * Top the soup back up with fresh random molecules: towards the initial
   * count, or towards the initial mass (the count then floats, capped at
   * `maxPopulationFactor` × the initial count). With conservation on, every
   * new molecule is paid for from the pool.
   */
  private flowIn(): void {
    const { initMinSize, initMaxSize } = this.reactor.cfg;
    const byMass = this.refillBy === "mass";
    let alive = this.aliveCount();
    let deficit = byMass ? this.targetMass - this.soupMass() : 0;
    const cap = byMass ? Math.floor(this.target * this.cfg.maxPopulationFactor) : this.target;
    for (let i = 0; i < this.cfg.inflowPerStep && alive < cap; i++) {
      let maxSize = initMaxSize;
      // Don't overshoot the mass target, and only build what the pool can pay for.
      if (byMass) maxSize = Math.min(maxSize, deficit);
      if (this.conserve) maxSize = Math.min(maxSize, Math.floor(this.pool));
      if (maxSize < initMinSize) break;
      const term = randomNormalTerm(this.rng, initMinSize, maxSize, this.reactor.cfg.limits);
      if (this.conserve) this.pool -= term.size;
      deficit -= term.size;
      alive++;
      this.particles.push(this.spawnRandomly(term));
    }
  }

  private integrate(dt: number): void {
    const { brownian, damping } = this.cfg;
    const kick = brownian * this.mixing * Math.sqrt(dt);
    const wall = this.wall;
    const half = this.width / 2;
    const decay = Math.exp(-damping * dt);
    const s = this.stir;
    const W = this.width;
    const H = this.height;

    for (const p of this.particles) {
      p.age += dt;
      if (p.cooldown > 0) p.cooldown -= dt;
      if (p.dying >= 0) {
        if (p.merge) {
          // Drawn into the collision point while it shrinks away.
          const k = Math.min(1, 14 * dt);
          p.x += (p.merge.x - p.x) * k;
          p.y += (p.merge.y - p.y) * k;
        }
        continue;
      }

      p.vx = p.vx * decay + this.rng.gauss() * kick;
      p.vy = p.vy * decay + this.rng.gauss() * kick;

      if (s) {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const wgt = Math.exp(-(dx * dx + dy * dy) / (2 * s.radius * s.radius));
        if (wgt > 0.01) {
          const k = Math.min(1, s.strength * wgt * dt);
          p.vx += (s.vx - p.vx) * k;
          p.vy += (s.vy - p.vy) * k;
        }
      }

      const left = p.x < half;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (wall) this.confine(p, left);
      if (p.x < 0) p.x += W;
      else if (p.x >= W) p.x -= W;
      if (p.y < 0) p.y += H;
      else if (p.y >= H) p.y -= H;
    }
  }

  private rebuildGrid(): void {
    const cols = Math.max(1, Math.round(this.width / this.cfg.cellW));
    const rows = Math.max(1, Math.round(this.height / this.cfg.cellH));
    this.csx = this.width / cols;
    this.csy = this.height / rows;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.grid = Array.from({ length: cols * rows }, () => []);
    } else {
      for (const cell of this.grid) cell.length = 0;
    }
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.dying >= 0) continue;
      const c0 = Math.floor((p.x - p.w / 2) / this.csx);
      const c1 = Math.min(c0 + cols - 1, Math.floor((p.x + p.w / 2) / this.csx));
      const r0 = Math.floor((p.y - p.h / 2) / this.csy);
      const r1 = Math.min(r0 + rows - 1, Math.floor((p.y + p.h / 2) / this.csy));
      for (let r = r0; r <= r1; r++) {
        const row = mod(r, rows) * cols;
        for (let c = c0; c <= c1; c++) this.grid[row + mod(c, cols)].push(i);
      }
    }
  }

  private collide(events: ReactionEvent[]): void {
    this.rebuildGrid();
    const ps = this.particles;
    const { cols, rows, csx, csy, width: W, height: H } = this;
    let budget = this.cfg.reactionBudget;
    const products: Particle[] = [];

    for (let ci = 0; ci < this.grid.length; ci++) {
      const cell = this.grid[ci];
      const cc = ci % cols;
      const cr = (ci - cc) / cols;
      for (let m = 0; m < cell.length; m++) {
        const a = ps[cell[m]];
        for (let n = m + 1; n < cell.length; n++) {
          const b = ps[cell[n]];
          if (a.dying >= 0 || b.dying >= 0) continue;
          // Minimum-image displacement on the torus.
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          if (dx > W / 2) dx -= W;
          else if (dx < -W / 2) dx += W;
          if (dy > H / 2) dy -= H;
          else if (dy < -H / 2) dy += H;
          const ox = (a.w + b.w) / 2 - Math.abs(dx);
          const oy = (a.h + b.h) / 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;

          // Pairs sharing several cells: handle only in the cell holding the
          // top-left corner of their intersection (in a's frame, wrapped).
          const ix = Math.max(a.x - a.w / 2, a.x + dx - b.w / 2);
          const iy = Math.max(a.y - a.h / 2, a.y + dy - b.h / 2);
          if (mod(Math.floor(ix / csx), cols) !== cc || mod(Math.floor(iy / csy), rows) !== cr) continue;

          this.separate(a, b, dx, dy, ox, oy);

          if (a.cooldown <= 0 && b.cooldown <= 0 && budget > 0) {
            a.cooldown = b.cooldown = this.cfg.cooldown;
            if (this.rng.chance(this.cfg.pReact)) {
              budget--;
              const p = this.tryReact(a, b, dx, dy);
              if (p) {
                products.push(p);
                events.push({ x: p.x, y: p.y, product: p });
              }
            }
          }
        }
      }
    }

    for (const p of products) ps.push(p);
  }

  private separate(a: Particle, b: Particle, dx: number, dy: number, ox: number, oy: number): void {
    const half = this.width / 2;
    const aLeft = a.x < half;
    const bLeft = b.x < half;
    // Compare overlap relative to box extent so wide labels also get pushed sideways.
    if (ox / (a.w + b.w) < oy / (a.h + b.h)) {
      const s = dx >= 0 ? 1 : -1;
      a.x -= (s * ox) / 2;
      b.x += (s * ox) / 2;
      if ((b.vx - a.vx) * s < 0) {
        const t = a.vx;
        a.vx = b.vx;
        b.vx = t;
      }
    } else {
      const s = dy >= 0 ? 1 : -1;
      a.y -= (s * oy) / 2;
      b.y += (s * oy) / 2;
      if ((b.vy - a.vy) * s < 0) {
        const t = a.vy;
        a.vy = b.vy;
        b.vy = t;
      }
    }
    if (this.wall) {
      this.confine(a, aLeft);
      this.confine(b, bLeft);
    }
    this.wrap(a);
    this.wrap(b);
  }

  private wrap(p: Particle): void {
    if (p.x < 0) p.x += this.width;
    else if (p.x >= this.width) p.x -= this.width;
    if (p.y < 0) p.y += this.height;
    else if (p.y >= this.height) p.y -= this.height;
  }

  /** (dx, dy): b's position relative to a, minimum image. */
  private tryReact(a: Particle, b: Particle, dx: number, dy: number): Particle | null {
    const [f, x] = this.rng.chance(0.5) ? [a, b] : [b, a];
    const consumptive = this.mode === "consumptive";
    // Copies are harmless when reactants are consumed (A + B → B just removes A).
    const product = this.reactor.react(f.term, x.term, consumptive ? false : undefined);
    if (!product) return null;
    const mx = a.x + dx / 2;
    const my = a.y + dy / 2;
    const px = mod(mx, this.width);
    const py = mod(my, this.height);

    // Mass bookkeeping. Catalytic: the product is new mass and the diluted
    // molecule's mass is freed. Consumptive: the reactants turn into the product.
    let victim: Particle | null = null;
    let cost: number;
    if (consumptive) {
      cost = product.size - a.term.size - b.term.size;
    } else {
      victim = this.pickNear(px, py);
      cost = product.size - (victim ? victim.term.size : 0);
    }
    if (this.conserve) {
      if (cost > this.pool) {
        this.starved++;
        return null; // not enough free mass: elastic
      }
      this.pool -= cost;
    }
    if (victim) victim.dying = 0;

    if (consumptive) {
      // Both reactants are used up and drift into the collision point.
      a.dying = b.dying = 0;
      a.merge = { x: mx, y: my };
      b.merge = { x: b.x - dx / 2, y: b.y - dy / 2 };
    }
    const p = this.spawn(product, px, py);
    p.product = true;
    const jitter = this.cfg.brownian * this.mixing;
    p.vx = (a.vx + b.vx) / 2 + this.rng.gauss() * jitter;
    p.vy = (a.vy + b.vy) / 2 + this.rng.gauss() * jitter;
    p.cooldown = this.cfg.cooldown * 2;
    return p;
  }

  /**
   * Random live molecule near (x, y): the one a catalytic product displaces
   * to hold N constant. Removing locally keeps density uniform; global
   * removal lets reaction hot spots pile up, since products appear where
   * reactions happen.
   */
  private pickNear(x: number, y: number): Particle | null {
    const ps = this.particles;
    const r = this.cfg.dilutionRadius;
    const W = this.width;
    const H = this.height;
    let victim: Particle | null = null;
    let seen = 0;
    // With the wall up, only molecules on the same side qualify.
    const half = W / 2;
    const side = (q: Particle) => !this.wall || q.x < half === x < half;
    for (const q of ps) {
      if (q.dying >= 0 || !side(q)) continue;
      let dx = Math.abs(q.x - x);
      let dy = Math.abs(q.y - y);
      dx = Math.min(dx, W - dx);
      dy = Math.min(dy, H - dy);
      if (dx * dx + dy * dy > r * r) continue;
      // Reservoir sampling: uniform choice among neighbours in one pass.
      if (this.rng.int(0, seen++) === 0) victim = q;
    }
    for (let tries = 0; !victim && tries < 32; tries++) {
      const q = ps[this.rng.int(0, ps.length - 1)];
      if (q.dying < 0 && side(q)) victim = q;
    }
    return victim;
  }

  private reap(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.dying < 0) continue;
      p.dying += dt;
      if (this.dyingProgress(p) >= 1) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
      }
    }
  }
}

function mod(a: number, n: number): number {
  const r = a % n;
  return r < 0 ? r + n : r;
}
