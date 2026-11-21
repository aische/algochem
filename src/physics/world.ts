import type { Term } from "../lambda/term";
import type { Reactor } from "../chem/soup";
import type { Rng } from "../rng";

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

export type Measure = (t: Term) => { w: number; h: number };

export class World {
  particles: Particle[] = [];
  stir: Stir | null = null;

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
    const speed = this.cfg.brownian / Math.sqrt(2 * this.cfg.damping);
    this.particles = terms.map((term) => {
      const p = this.spawn(term, this.rng.next() * this.width, this.rng.next() * this.height);
      p.vx = this.rng.gauss() * speed;
      p.vy = this.rng.gauss() * speed;
      p.age = 10; // initial molecules do not glow
      return p;
    });
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
    this.integrate(dt);
    this.collide(events);
    this.reap(dt);
  }

  // -------------------------------------------------------------------------

  private spawn(term: Term, x: number, y: number): Particle {
    const { w, h } = this.measure(term);
    return { term, x, y, vx: 0, vy: 0, w, h, cooldown: 0, age: 0, dying: -1 };
  }

  private integrate(dt: number): void {
    const { brownian, damping } = this.cfg;
    const kick = brownian * Math.sqrt(dt);
    const decay = Math.exp(-damping * dt);
    const s = this.stir;
    const W = this.width;
    const H = this.height;

    for (const p of this.particles) {
      p.age += dt;
      if (p.cooldown > 0) p.cooldown -= dt;
      if (p.dying >= 0) continue;

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

      p.x += p.vx * dt;
      p.y += p.vy * dt;
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
              const p = this.tryReact(a, b, a.x + dx / 2, a.y + dy / 2);
              if (p) {
                products.push(p);
                events.push({ x: p.x, y: p.y, product: p });
              }
            }
          }
        }
      }
    }

    for (const p of products) {
      ps.push(p);
      this.dilute(p);
    }
  }

  private separate(a: Particle, b: Particle, dx: number, dy: number, ox: number, oy: number): void {
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
    this.wrap(a);
    this.wrap(b);
  }

  private wrap(p: Particle): void {
    if (p.x < 0) p.x += this.width;
    else if (p.x >= this.width) p.x -= this.width;
    if (p.y < 0) p.y += this.height;
    else if (p.y >= this.height) p.y -= this.height;
  }

  private tryReact(a: Particle, b: Particle, mx: number, my: number): Particle | null {
    const [f, x] = this.rng.chance(0.5) ? [a, b] : [b, a];
    const product = this.reactor.react(f.term, x.term);
    if (!product) return null;
    const p = this.spawn(product, mod(mx, this.width), mod(my, this.height));
    const jitter = this.cfg.brownian;
    p.vx = (a.vx + b.vx) / 2 + this.rng.gauss() * jitter;
    p.vy = (a.vy + b.vy) / 2 + this.rng.gauss() * jitter;
    p.cooldown = this.cfg.cooldown * 2;
    return p;
  }

  /**
   * Remove one random live molecule near `keep` (other than `keep`) to hold N
   * constant. Removing locally keeps density uniform; global removal lets
   * reaction hot spots pile up, since products appear where reactions happen.
   */
  private dilute(keep: Particle): void {
    const ps = this.particles;
    const r = this.cfg.dilutionRadius;
    const W = this.width;
    const H = this.height;
    let victim: Particle | null = null;
    let seen = 0;
    for (const q of ps) {
      if (q === keep || q.dying >= 0) continue;
      let dx = Math.abs(q.x - keep.x);
      let dy = Math.abs(q.y - keep.y);
      dx = Math.min(dx, W - dx);
      dy = Math.min(dy, H - dy);
      if (dx * dx + dy * dy > r * r) continue;
      // Reservoir sampling: uniform choice among neighbours in one pass.
      if (this.rng.int(0, seen++) === 0) victim = q;
    }
    for (let tries = 0; !victim && tries < 32; tries++) {
      const q = ps[this.rng.int(0, ps.length - 1)];
      if (q !== keep && q.dying < 0) victim = q;
    }
    if (victim) victim.dying = 0;
  }

  private reap(dt: number): void {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (p.dying < 0) continue;
      p.dying += dt;
      if (p.dying >= this.cfg.dissolveTime) {
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
