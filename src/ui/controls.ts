import type { ReactionMode, RefillBy } from "../physics/world";
import { parse } from "../lambda/parse";
import { drawSparkline, FAMILIES_COLOR, SPECIES_COLOR, type Sample } from "./sparkline";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
export const MIXES = [0.25, 0.5, 1, 2, 4, 8];
/** Choices for the leading-binder limit; 0 = off. */
export const BINDER_LIMITS = [0, 6, 8, 12];

export interface ControlState {
  paused: boolean;
  speed: number;
  seed: string;
  population: number;
  mode: ReactionMode;
  /** Consumptive mode: refill the soup with fresh random molecules. */
  inflow: boolean;
  /** What inflow restores: the initial molecule count or the initial mass. */
  refillBy: RefillBy;
  /** Conserve total mass (AST nodes) via a free-mass pool. */
  conserve: boolean;
  /** Brownian motion multiplier (see World.mixing). */
  mixing: number;
  /** Refuse products with more leading binders than this; 0 = off. */
  maxBinders: number;
  /** Compact labels: unused binders as `_`. */
  compact: boolean;
  /** Color molecules by family. */
  colorFamilies: boolean;
  /** Reset into two halves (seed | seed2) with a wall between them. */
  split: boolean;
  seed2: string;
  /** Expression dropped by shift-click; empty = random molecules. */
  drop: string;
}

export interface ControlHandlers {
  onReset(): void;
  onToggleSpecies(): void;
  onToggleHelp(): void;
  /** Mode, inflow, conservation, binder limit or mixing changed (applies live). */
  onModeChange(): void;
  /** Label style or coloring changed. */
  onViewChange(): void;
  onRemoveWall(): void;
}

/** Small floating panel: pause, mode, speed, seed, population, reset. */
export class Controls {
  readonly state: ControlState;
  private root: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private seedInput: HTMLInputElement;
  private aliveEl: HTMLElement;
  private gauge!: { root: HTMLElement; fill: HTMLElement; text: HTMLElement };
  private spark: HTMLCanvasElement;
  private sparkText: HTMLElement;
  private samples: Sample[] = [];
  private sparkHover: number | null = null;
  private wallBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, initial: ControlState, private handlers: ControlHandlers) {
    this.state = { ...initial };
    this.root = document.createElement("div");
    this.root.className = "panel";
    this.root.innerHTML = `
      <div class="row">
        <button data-k="pause" title="Space">Pause</button>
        <button data-k="reset" title="R">Reset</button>
        <button data-k="help" class="help-btn" title="Help (?)">?</button>
      </div>
      <button data-k="species" title="L">Species list</button>
      <div class="field diversity">
        <canvas data-k="spark" class="spark" title="Species and families over the run (log scale)"></canvas>
        <div class="spark-text" data-k="sparktext"></div>
      </div>
      <div class="field">
        <span class="field-label">reaction</span>
        <div class="seg">
          <button data-mode="catalytic" title="Reactants survive; a nearby molecule is diluted away">Catalytic</button>
          <button data-mode="consumptive" title="Reactants are used up">Consumptive</button>
        </div>
        <div class="mode-desc" data-k="desc"></div>
        <div class="inflow-row">
          <label class="check"><input data-k="inflow" type="checkbox"> inflow</label>
          <div class="seg mini" data-k="refill" title="What inflow restores">
            <button data-refill="count" title="Refill to the initial molecule count">count</button>
            <button data-refill="mass" title="Refill to the initial soup mass; the count floats">mass</button>
          </div>
        </div>
      </div>
      <div class="field">
        <label class="check" title="Total AST nodes stay constant: shrinking reactions free mass, growing ones (and inflow) must draw on it">
          <input data-k="conserve" type="checkbox"> conserve mass
        </label>
        <div class="gauge" data-k="gauge">
          <div class="gauge-bar"><span data-k="gaugefill"></span></div>
          <div class="gauge-text" data-k="gaugetext"></div>
        </div>
      </div>
      <div class="field" title="Products with more leading binders are refused. Stops the growth of unused binders">
        <span class="field-label">max leading binders</span>
        <div class="seg mini" data-k="binders">
          ${BINDER_LIMITS.map((n) => `<button data-binders="${n}">${n || "off"}</button>`).join("")}
        </div>
      </div>
      <label>speed <span data-k="speedv"></span>
        <input data-k="speed" type="range" min="0" max="${SPEEDS.length - 1}" step="1">
      </label>
      <label title="How fast molecules wander. Low: regions evolve separately. High: close to a well-mixed soup">mixing <span data-k="mixv"></span>
        <input data-k="mix" type="range" min="0" max="${MIXES.length - 1}" step="1">
      </label>
      <label>molecules <span data-k="popv"></span>
        <input data-k="pop" type="range" min="300" max="1000" step="50">
      </label>
      <label class="seed">seed
        <span class="row">
          <input data-k="seed" type="text" spellcheck="false">
          <button data-k="dice" title="Random seed">⚄</button>
        </span>
      </label>
      <div class="field">
        <label class="check" title="On reset, the left half starts from the seed and the right half from a second seed, with a wall between them">
          <input data-k="split" type="checkbox"> split, right half seed
        </label>
        <span class="row">
          <input data-k="seed2" type="text" spellcheck="false">
          <button data-k="dice2" title="Random second seed">⚄</button>
        </span>
        <button data-k="wall" hidden>Remove wall</button>
      </div>
      <div class="field">
        <span class="field-label">view</span>
        <label class="check" title="Unused binders print as _ (a run of n as _ⁿ); hover a molecule for the full expression">
          <input data-k="compact" type="checkbox"> compact labels
        </label>
        <label class="check" title="The largest families get their own color">
          <input data-k="color" type="checkbox"> color by family
        </label>
      </div>
      <label title="Shift-click the soup to drop 10 copies of this expression, or 10 random molecules if empty">shift-click drops
        <input data-k="drop" type="text" spellcheck="false" placeholder="random molecules">
      </label>
      <div class="alive"><span data-k="alive">0</span> molecules now</div>
      <div class="hint">drag to stir · shift-click drop · space pause · R reset · L species · H hide · ? help</div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(k: string) => this.root.querySelector<T>(`[data-k="${k}"]`)!;
    this.pauseBtn = q<HTMLButtonElement>("pause");
    this.seedInput = q<HTMLInputElement>("seed");
    const speed = q<HTMLInputElement>("speed");
    const speedv = q("speedv");
    const pop = q<HTMLInputElement>("pop");
    const popv = q("popv");
    this.aliveEl = q("alive");
    this.spark = q<HTMLCanvasElement>("spark");
    this.sparkText = q("sparktext");
    this.wallBtn = q<HTMLButtonElement>("wall");

    const modeBtns = this.root.querySelectorAll<HTMLButtonElement>("[data-mode]");
    const inflow = q<HTMLInputElement>("inflow");
    const desc = q("desc");
    const refill = q("refill");
    const refillBtns = refill.querySelectorAll<HTMLButtonElement>("[data-refill]");
    const syncMode = () => {
      const consumptive = this.state.mode === "consumptive";
      for (const b of modeBtns) b.classList.toggle("on", b.dataset.mode === this.state.mode);
      inflow.checked = this.state.inflow;
      inflow.disabled = !consumptive;
      inflow.parentElement!.classList.toggle("disabled", !consumptive);
      const refillActive = consumptive && this.state.inflow;
      refill.classList.toggle("disabled", !refillActive);
      for (const b of refillBtns) {
        b.disabled = !refillActive;
        b.classList.toggle("on", b.dataset.refill === this.state.refillBy);
      }
      desc.textContent = !consumptive
        ? "A + B → A + B + C, one nearby molecule removed"
        : !this.state.inflow
          ? "A + B → C, the soup shrinks"
          : this.state.refillBy === "mass"
            ? "A + B → C, inflow restores the mass"
            : "A + B → C, inflow restores the count";
    };
    for (const b of refillBtns) {
      b.addEventListener("click", () => {
        this.state.refillBy = b.dataset.refill as RefillBy;
        syncMode();
        this.handlers.onModeChange();
      });
    }
    const conserve = q<HTMLInputElement>("conserve");
    conserve.checked = this.state.conserve;
    this.gauge = { root: q("gauge"), fill: q("gaugefill"), text: q("gaugetext") };
    conserve.addEventListener("change", () => {
      this.state.conserve = conserve.checked;
      conserve.blur(); // keep Space for pause
      this.handlers.onModeChange();
    });
    for (const b of modeBtns) {
      b.addEventListener("click", () => {
        this.state.mode = b.dataset.mode as ReactionMode;
        syncMode();
        this.handlers.onModeChange();
      });
    }
    inflow.addEventListener("change", () => {
      this.state.inflow = inflow.checked;
      inflow.blur(); // keep Space for pause
      syncMode();
      this.handlers.onModeChange();
    });
    syncMode();

    const binderBtns = this.root.querySelectorAll<HTMLButtonElement>("[data-binders]");
    const syncBinders = () => {
      for (const b of binderBtns) b.classList.toggle("on", Number(b.dataset.binders) === this.state.maxBinders);
    };
    for (const b of binderBtns) {
      b.addEventListener("click", () => {
        this.state.maxBinders = Number(b.dataset.binders);
        syncBinders();
        this.handlers.onModeChange();
      });
    }
    syncBinders();

    const mix = q<HTMLInputElement>("mix");
    const mixv = q("mixv");
    mix.value = String(Math.max(0, MIXES.indexOf(this.state.mixing)));
    const syncMix = () => {
      this.state.mixing = MIXES[Number(mix.value)];
      mixv.textContent = `${this.state.mixing}×`;
    };
    mix.addEventListener("input", () => {
      syncMix();
      this.handlers.onModeChange();
    });
    syncMix();

    const checkbox = (k: string, get: () => boolean, set: (v: boolean) => void, after: () => void) => {
      const el = q<HTMLInputElement>(k);
      el.checked = get();
      el.addEventListener("change", () => {
        set(el.checked);
        el.blur(); // keep Space for pause
        after();
      });
    };
    checkbox("compact", () => this.state.compact, (v) => (this.state.compact = v), () => this.handlers.onViewChange());
    checkbox("color", () => this.state.colorFamilies, (v) => (this.state.colorFamilies = v), () => this.handlers.onViewChange());

    const seed2 = q<HTMLInputElement>("seed2");
    const syncSplit = () => {
      seed2.disabled = !this.state.split;
      seed2.parentElement!.classList.toggle("disabled", !this.state.split);
    };
    checkbox(
      "split",
      () => this.state.split,
      (v) => {
        this.state.split = v;
        if (v && !seed2.value.trim()) seed2.value = this.state.seed2 = randomSeed();
      },
      syncSplit,
    );
    seed2.value = this.state.seed2;
    syncSplit();
    seed2.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.reset();
    });
    q("dice2").addEventListener("click", () => {
      seed2.value = randomSeed();
      if (this.state.split) this.reset();
      else this.state.seed2 = seed2.value;
    });
    this.wallBtn.addEventListener("click", () => this.handlers.onRemoveWall());

    const drop = q<HTMLInputElement>("drop");
    drop.value = this.state.drop;
    const syncDrop = () => {
      this.state.drop = drop.value.trim();
      let error = "";
      if (this.state.drop) {
        try {
          parse(this.state.drop);
        } catch (e) {
          error = (e as Error).message;
        }
      }
      drop.classList.toggle("invalid", error !== "");
      drop.title = error;
    };
    drop.addEventListener("input", syncDrop);
    drop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") drop.blur();
    });
    syncDrop();

    this.spark.addEventListener("pointermove", (e) => {
      this.sparkHover = e.offsetX;
      this.drawSpark();
    });
    this.spark.addEventListener("pointerleave", () => {
      this.sparkHover = null;
      this.drawSpark();
    });

    speed.value = String(Math.max(0, SPEEDS.indexOf(this.state.speed)));
    const syncSpeed = () => {
      this.state.speed = SPEEDS[Number(speed.value)];
      speedv.textContent = `${this.state.speed}×`;
    };
    speed.addEventListener("input", syncSpeed);
    syncSpeed();

    pop.value = String(this.state.population);
    const syncPop = () => {
      this.state.population = Number(pop.value);
      popv.textContent = `${this.state.population} on reset`;
    };
    pop.addEventListener("input", syncPop);
    syncPop();

    this.seedInput.value = this.state.seed;
    this.seedInput.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing a seed must not trigger shortcuts
      if (e.key === "Enter") this.reset();
    });

    this.pauseBtn.addEventListener("click", () => this.togglePause());
    q("reset").addEventListener("click", () => this.reset());
    q("species").addEventListener("click", () => this.handlers.onToggleSpecies());
    q("help").addEventListener("click", () => this.handlers.onToggleHelp());
    q("dice").addEventListener("click", () => {
      this.seedInput.value = randomSeed();
      this.reset();
    });

    // Drop focus after clicks so Space toggles pause instead of re-pressing a button.
    this.root.addEventListener("click", (e) => {
      if (e.target instanceof HTMLButtonElement) e.target.blur();
    });

    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type === "text") return;
      if (e.code === "Space") {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === "r" || e.key === "R") {
        this.reset();
      } else if (e.key === "l" || e.key === "L") {
        this.handlers.onToggleSpecies();
      } else if (e.key === "?") {
        this.handlers.onToggleHelp();
      } else if (e.key === "h" || e.key === "H") {
        this.root.classList.toggle("hidden");
      }
    });
  }

  /** Live readouts: molecule count and the mass gauge. */
  setStats(alive: number, pool: number, soupMass: number): void {
    this.aliveEl.textContent = String(alive);
    const g = this.gauge;
    g.root.classList.toggle("off", !this.state.conserve);
    const total = pool + soupMass;
    g.fill.style.width = `${total > 0 ? (100 * pool) / total : 0}%`;
    g.text.textContent = this.state.conserve
      ? `${fmt(pool)} free · ${fmt(total)} total`
      : `off · ${fmt(soupMass)} in soup`;
  }

  /** New diversity history; redraws the sparkline and its readout. */
  setHistory(samples: Sample[]): void {
    this.samples = samples;
    this.drawSpark();
  }

  /** Show the "Remove wall" button while the wall is up. */
  setWall(up: boolean): void {
    this.wallBtn.hidden = !up;
  }

  /** The drop expression, if it is a valid closed term. */
  dropExpression(): string | null {
    if (!this.state.drop) return null;
    try {
      parse(this.state.drop);
      return this.state.drop;
    } catch {
      return null;
    }
  }

  private drawSpark(): void {
    const i = drawSparkline(this.spark, this.samples, this.sparkHover);
    const s = i !== null ? this.samples[i] : this.samples[this.samples.length - 1];
    const sw = (c: string) => `<i style="background:${c}"></i>`;
    this.sparkText.innerHTML = s
      ? `${sw(SPECIES_COLOR)}${s.species} species ${sw(FAMILIES_COLOR)}${s.families} families` +
        (i !== null ? ` <span class="when">${formatTime(s.t)}</span>` : "")
      : "";
  }

  togglePause(): void {
    this.state.paused = !this.state.paused;
    this.pauseBtn.textContent = this.state.paused ? "Play" : "Pause";
  }

  private reset(): void {
    this.state.seed = this.seedInput.value.trim() || randomSeed();
    this.seedInput.value = this.state.seed;
    const seed2 = this.root.querySelector<HTMLInputElement>('[data-k="seed2"]')!;
    if (this.state.split) {
      this.state.seed2 = seed2.value.trim() || randomSeed();
      seed2.value = this.state.seed2;
    }
    this.handlers.onReset();
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(Math.floor(s % 60)).padStart(2, "0")}s` : `${Math.floor(s)}s`;
}

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
