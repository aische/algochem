import type { ReactionMode } from "../physics/world";

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export interface ControlState {
  paused: boolean;
  speed: number;
  seed: string;
  population: number;
  mode: ReactionMode;
  /** Consumptive mode: refill the soup with fresh random molecules. */
  inflow: boolean;
}

export interface ControlHandlers {
  onReset(): void;
  onToggleSpecies(): void;
  /** Mode or inflow changed (applies live). */
  onModeChange(): void;
}

/** Small floating panel: pause, mode, speed, seed, population, reset. */
export class Controls {
  readonly state: ControlState;
  private root: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private seedInput: HTMLInputElement;
  private aliveEl: HTMLElement;

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
        <label class="check"><input data-k="inflow" type="checkbox"> inflow</label>
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
    const syncMode = () => {
      const consumptive = this.state.mode === "consumptive";
      for (const b of modeBtns) b.classList.toggle("on", b.dataset.mode === this.state.mode);
      inflow.checked = this.state.inflow;
      inflow.disabled = !consumptive;
      inflow.parentElement!.classList.toggle("disabled", !consumptive);
      desc.textContent = !consumptive
        ? "A + B → A + B + C, one nearby molecule removed"
        : this.state.inflow
          ? "A + B → C, fresh molecules flow in"
          : "A + B → C, the soup shrinks";
    };
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

  setAlive(n: number): void {
    this.aliveEl.textContent = String(n);
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

export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}
