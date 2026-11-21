export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

export interface ControlState {
  paused: boolean;
  speed: number;
  seed: string;
  population: number;
}

export interface ControlHandlers {
  onReset(): void;
  onToggleSpecies(): void;
}

/** Small floating panel: pause, speed, seed, population, reset. */
export class Controls {
  readonly state: ControlState;
  private root: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private seedInput: HTMLInputElement;

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
      popv.textContent = `${this.state.population} (on reset)`;
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
      if (e.target instanceof HTMLInputElement) return;
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
