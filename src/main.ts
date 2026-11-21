import "./style.css";
import { Rng } from "./rng";
import { Reactor, randomSoup, DEFAULT_CHEM } from "./chem/soup";
import { World, type ReactionEvent, type Particle } from "./physics/world";
import { Renderer } from "./render/renderer";
import { Controls, randomSeed, MIXES, BINDER_LIMITS } from "./ui/controls";
import { SpeciesDrawer } from "./ui/species";
import { HelpOverlay } from "./ui/help";
import { History } from "./ui/sparkline";
import { FamilyColors } from "./render/familyColors";
import { familySummary } from "./chem/family";
import { print } from "./lambda/print";
import { parse } from "./lambda/parse";
import { randomClosedTerm } from "./lambda/random";

const DT = 1 / 60; // fixed simulation step (s)
const MAX_STEPS_PER_FRAME = 16;
// Wall-clock budget for simulation per frame. At high speeds the sim falls
// behind instead of dropping the frame rate.
const SIM_BUDGET_MS = 8;
const STIR_RADIUS = 110;
const STIR_STRENGTH = 10;
const DROP_COUNT = 10; // molecules per shift-click
const COLOR_UPDATE_MS = 1000;
// Evolved terms tend to get longer. The camera eases out so labels cover at
// most about this fraction of the screen.
const TARGET_COVERAGE = 0.65;
const MIN_ZOOM = 0.55;
const ZOOM_TAU = 3; // seconds

const canvas = document.querySelector<HTMLCanvasElement>("#soup")!;
const tooltip = document.querySelector<HTMLDivElement>("#tooltip")!;
const renderer = new Renderer(canvas);
const reactor = new Reactor(DEFAULT_CHEM);
const colors = new FamilyColors();
const history = new History();
renderer.colorSlot = colors.slotOf;
// Random molecules dropped by shift-click; not tied to the seed.
const dropRng = new Rng(Math.floor(Math.random() * 2 ** 32));

const params = new URLSearchParams(location.search);
const controls = new Controls(
  document.body,
  {
    paused: false,
    speed: 1,
    seed: params.get("seed") ?? randomSeed(),
    population: clamp(Number(params.get("n")) || 600, 300, 1000),
    mode: params.get("mode") === "consumptive" ? "consumptive" : "catalytic",
    inflow: params.get("inflow") !== "0",
    refillBy: params.get("refill") === "mass" ? "mass" : "count",
    conserve: params.get("conserve") === "1",
    mixing: MIXES.includes(Number(params.get("mix"))) ? Number(params.get("mix")) : 1,
    maxBinders: BINDER_LIMITS.includes(Number(params.get("binders"))) ? Number(params.get("binders")) : 0,
    compact: params.get("compact") === "1",
    colorFamilies: params.get("color") === "1",
    split: params.has("split"),
    seed2: params.get("split") || randomSeed(),
    drop: "",
  },
  {
    onReset: reset,
    onToggleSpecies: () => drawer.toggle(),
    onToggleHelp: () => help.toggle(),
    onModeChange: applyMode,
    onViewChange: applyView,
    onRemoveWall: () => {
      world.wall = false;
      controls.setWall(false);
    },
  },
);

let world: World;
const drawer = new SpeciesDrawer(document.body, () => world, {
  get compact() {
    return renderer.compact;
  },
  colorOf: (key) => colors.colorOf(key),
});
const help = new HelpOverlay(document.body);
let zoom = 1;

function reset(): void {
  const { seed, seed2, split, population } = controls.state;
  const rng = new Rng(seed);
  zoom = 1;
  world = new World(renderer.width, renderer.height, rng, reactor, renderer.measure);
  if (split) {
    const left = randomSoup(rng, Math.floor(population / 2), reactor.cfg);
    const right = randomSoup(new Rng(seed2), Math.ceil(population / 2), reactor.cfg);
    world.populateSplit(left, right);
  } else {
    world.populate(randomSoup(rng, population, reactor.cfg));
  }
  controls.setWall(world.wall);
  history.reset();
  colors.reset();
  lastColorUpdate = -Infinity;
  applyMode();
  drawer.reset();
}

/** Push label style and coloring into the renderer and the URL. */
function applyView(): void {
  const { compact, colorFamilies } = controls.state;
  colors.enabled = colorFamilies;
  lastColorUpdate = -Infinity; // rank families right away
  if (renderer.compact !== compact) {
    renderer.compact = compact;
    world.remeasure();
    drawer.reset();
  }
  updateUrl();
}

/** Push mode, inflow, mixing and the binder limit into the world (applies live, no reset). */
function applyMode(): void {
  const { mode, inflow, refillBy, conserve, mixing, maxBinders } = controls.state;
  world.mode = mode;
  world.inflow = inflow;
  world.refillBy = refillBy;
  world.conserve = conserve;
  world.mixing = mixing;
  reactor.maxBinders = maxBinders > 0 ? maxBinders : Infinity;
  applyView();
}

/** Keep the settings in the URL, so a link reproduces the setup. */
function updateUrl(): void {
  const { seed, seed2, split, mode, inflow, refillBy, conserve, mixing, maxBinders, compact, colorFamilies } =
    controls.state;
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  url.searchParams.delete("mode");
  url.searchParams.delete("inflow");
  url.searchParams.delete("refill");
  if (mode === "consumptive") {
    url.searchParams.set("mode", mode);
    if (!inflow) url.searchParams.set("inflow", "0");
    else if (refillBy === "mass") url.searchParams.set("refill", "mass");
  }
  const flag = (name: string, value: string | null) =>
    value === null ? url.searchParams.delete(name) : url.searchParams.set(name, value);
  flag("conserve", conserve ? "1" : null);
  flag("split", split ? seed2 : null);
  flag("mix", mixing !== 1 ? String(mixing) : null);
  flag("binders", maxBinders > 0 ? String(maxBinders) : null);
  flag("compact", compact ? "1" : null);
  flag("color", colorFamilies ? "1" : null);
  window.history.replaceState(null, "", url);
}

function updateZoom(dt: number): void {
  // Coverage the current labels would have at zoom 1.
  const atOne = world.coverage() / (zoom * zoom);
  const target = clamp(Math.sqrt(TARGET_COVERAGE / Math.max(atOne, 1e-9)), MIN_ZOOM, 1);
  const next = zoom + (target - zoom) * (1 - Math.exp(-dt / ZOOM_TAU));
  if (Math.abs(next - zoom) < 1e-5) return;
  zoom = next;
  world.resize(renderer.width / zoom, renderer.height / zoom);
}

// --- Mouse: stir while dragging, hover tooltip otherwise -------------------
// Pointer positions are kept in screen px; the world sees them divided by zoom.

const mouse = { x: -1, y: -1, vx: 0, vy: 0, down: false, t: 0, inside: false };

canvas.addEventListener("pointerdown", (e) => {
  if (e.shiftKey) {
    dropAt(e.offsetX / zoom, e.offsetY / zoom);
    return;
  }
  mouse.down = true;
  mouse.vx = mouse.vy = 0;
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
  mouse.t = performance.now();
  mouse.inside = true;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("stirring");
});
canvas.addEventListener("pointerup", () => {
  mouse.down = false;
  canvas.classList.remove("stirring");
});
canvas.addEventListener("pointerleave", () => (mouse.inside = false));
canvas.addEventListener("pointermove", (e) => {
  const now = performance.now();
  const dt = Math.max(1, now - mouse.t) / 1000;
  if (mouse.down && mouse.inside) {
    // Smoothed pointer velocity in px/s.
    mouse.vx = 0.6 * mouse.vx + 0.4 * ((e.offsetX - mouse.x) / dt);
    mouse.vy = 0.6 * mouse.vy + 0.4 * ((e.offsetY - mouse.y) / dt);
  }
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
  mouse.t = now;
  mouse.inside = true;
});

/** Shift-click: copies of the typed expression, or random molecules. */
function dropAt(x: number, y: number): void {
  const src = controls.dropExpression();
  const { initMinSize, initMaxSize } = reactor.cfg;
  // Parsed here, not stored: terms kept outside the soup would go stale
  // when the intern table is garbage-collected.
  const terms = Array.from({ length: DROP_COUNT }, () =>
    src ? parse(src) : randomClosedTerm(dropRng, initMinSize, initMaxSize),
  );
  world.drop(terms, x, y);
  renderer.flash(x, y, performance.now());
}

function updateTooltip(p: Particle | null): void {
  if (!p || mouse.down) {
    tooltip.hidden = true;
    return;
  }
  let count = 0;
  for (const q of world.particles) if (q.term === p.term && q.dying < 0) count++;
  tooltip.hidden = false;
  tooltip.textContent = print(p.term);
  tooltip.dataset.count = `×${count}`;
  const pad = 14;
  const r = tooltip.getBoundingClientRect();
  const x = Math.min(mouse.x + pad, window.innerWidth - r.width - 8);
  const y = mouse.y + pad + r.height > window.innerHeight ? mouse.y - r.height - pad : mouse.y + pad;
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
}

// --- Main loop --------------------------------------------------------------

const events: ReactionEvent[] = [];
let last = performance.now();
let simAccum = 0;
let lastAliveUpdate = -Infinity;
let lastColorUpdate = -Infinity;

function frame(now: number): void {
  const tStart = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  world.stir = mouse.down
    ? {
        x: mouse.x / zoom,
        y: mouse.y / zoom,
        vx: mouse.vx / zoom,
        vy: mouse.vy / zoom,
        radius: STIR_RADIUS / zoom,
        strength: STIR_STRENGTH,
      }
    : null;
  // Holding the pointer still should stop pushing.
  mouse.vx *= 0.85;
  mouse.vy *= 0.85;

  if (!controls.state.paused) {
    simAccum = Math.min(simAccum + realDt * controls.state.speed, DT * MAX_STEPS_PER_FRAME);
    while (simAccum >= DT) {
      world.step(DT, events);
      simAccum -= DT;
      if (performance.now() - tStart > SIM_BUDGET_MS) {
        simAccum = 0; // drop the backlog rather than spiral
        break;
      }
    }
    for (const ev of events) renderer.flash(ev.x, ev.y, now);
    events.length = 0;
    reactor.maybeCollect(world.liveTerms());
    updateZoom(realDt);
  }

  const tSim = performance.now();
  const hovered = mouse.inside && !mouse.down ? world.pick(mouse.x / zoom, mouse.y / zoom) : null;
  sampleDiversity(now);
  renderer.draw(world, now, hovered, zoom, drawer.highlight);
  updateTooltip(hovered);
  drawer.tick(now);
  if (now - lastAliveUpdate > 250) {
    controls.setStats(world.aliveCount(), world.pool, world.soupMass());
    lastAliveUpdate = now;
  }
  if (perf) perf.sample(tSim - tStart, performance.now() - tSim);
  requestAnimationFrame(frame);
}

/** Record species/family counts for the sparkline; re-rank family colors. */
function sampleDiversity(now: number): void {
  const sampleDue = history.due(world.time);
  const colorDue = colors.enabled && now - lastColorUpdate >= COLOR_UPDATE_MS;
  if (!sampleDue && !colorDue) return;
  const species = world.speciesSummary();
  const families = familySummary(species);
  if (sampleDue) {
    history.push({ t: world.time, species: species.length, families: families.length });
    controls.setHistory(history.samples);
  }
  if (colorDue) {
    colors.update(families);
    lastColorUpdate = now;
  }
}

// `?perf` logs average JS time per frame (simulation / drawing) every 3 s.
const perf = params.has("perf")
  ? {
      sim: 0,
      draw: 0,
      n: 0,
      t0: performance.now(),
      sample(simMs: number, drawMs: number) {
        this.sim += simMs;
        this.draw += drawMs;
        this.n++;
        if (performance.now() - this.t0 > 3000) {
          const species = new Set(world.particles.map((p) => p.term.id)).size;
          console.log(
            `[perf] sim ${(this.sim / this.n).toFixed(2)} ms, draw ${(this.draw / this.n).toFixed(2)} ms, ` +
              `${(this.n / 3).toFixed(0)} fps, ` +
              `${world.aliveCount()} molecules, ${species} species, zoom ${zoom.toFixed(2)}, ` +
              `coverage ${world.coverage().toFixed(2)}, pool ${world.pool}, soup mass ${world.soupMass()}, ` +
              `starved ${world.starved}, ${JSON.stringify(reactor.stats)}`,
          );
          this.sim = this.draw = this.n = 0;
          this.t0 = performance.now();
        }
      },
    }
  : null;

window.addEventListener("resize", () => {
  renderer.resize();
  world.resize(renderer.width / zoom, renderer.height / zoom);
});

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

reset();
requestAnimationFrame(frame);

// Debug handle for poking at the soup from the console (only with `?perf`).
if (perf) Object.assign(window, { algochem: { world: () => world, reactor, zoom: () => zoom } });
