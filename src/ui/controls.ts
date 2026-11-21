import type { ReactionMode, RefillBy } from "../physics/world";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

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
}

export interface ControlHandlers {
  onReset(): void;
  onToggleSpecies(): void;
  /** Mode, inflow or conservation changed (applies live). */
  onModeChange(): void;
}

/** Small floating panel: pause, mode, speed, seed, population, reset. */
export class Controls {
  readonly state: ControlState;
  private root: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private seedInput: HTMLInputElement;
  private aliveEl: HTMLElement;
  private gauge!: { root: HTMLElement; fill: HTMLElement; text: HTMLElement };

  constructor(parent: HTMLElement, initial: ControlState, private handlers: ControlHandlers) {
    this.state = { ...initial };
    this.root = document.createElement("div");
    this.root.className = "panel";
    this.root.innerHTML = `
      <div class="row">
        <button data-k="pause" title="Space">Pause</button>
        <button data-k="reset" title="R">Reset</button>
      </div>
      <button data-k="species" title="L">Species list</button>
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
      <label>speed <span data-k="speedv"></span>
        <input data-k="speed" type="range" min="0" max="${SPEEDS.length - 1}" step="1">
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
      <div class="alive"><span data-k="alive">0</span> molecules now</div>
      <div class="hint">drag to stir · space pause · R reset · L species · H hide</div>
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

  togglePause(): void {
    this.state.paused = !this.state.paused;
    this.pauseBtn.textContent = this.state.paused ? "Play" : "Pause";
  }

  private reset(): void {
    this.state.seed = this.seedInput.value.trim() || randomSeed();
    this.seedInput.value = this.state.seed;
    this.handlers.onReset();
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
