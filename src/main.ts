import "./style.css";
import { Rng } from "./rng";
import { Reactor, randomSoup, DEFAULT_CHEM } from "./chem/soup";
import { World, type ReactionEvent, type Particle } from "./physics/world";
import { Renderer } from "./render/renderer";
import { Controls, randomSeed } from "./ui/controls";
import { SpeciesDrawer } from "./ui/species";
import { HelpOverlay } from "./ui/help";
import { print } from "./lambda/print";

const DT = 1 / 60; // fixed simulation step (s)
const MAX_STEPS_PER_FRAME = 16;
// Wall-clock budget for simulation per frame. At high speeds the sim falls
// behind instead of dropping the frame rate.
const SIM_BUDGET_MS = 8;
const STIR_RADIUS = 110;
const STIR_STRENGTH = 10;
// Evolved terms tend to get longer. The camera eases out so labels cover at
// most about this fraction of the screen.
const TARGET_COVERAGE = 0.65;
const MIN_ZOOM = 0.55;
const ZOOM_TAU = 3; // seconds

const canvas = document.querySelector<HTMLCanvasElement>("#soup")!;
const tooltip = document.querySelector<HTMLDivElement>("#tooltip")!;
const renderer = new Renderer(canvas);
const reactor = new Reactor(DEFAULT_CHEM);

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
  },
  {
    onReset: reset,
    onToggleSpecies: () => drawer.toggle(),
    onToggleHelp: () => help.toggle(),
    onModeChange: applyMode,
  },
);

let world: World;
const drawer = new SpeciesDrawer(document.body, () => world);
const help = new HelpOverlay(document.body);
let zoom = 1;

function reset(): void {
  const { seed, population } = controls.state;
  const rng = new Rng(seed);
  zoom = 1;
  world = new World(renderer.width, renderer.height, rng, reactor, renderer.measure);
  world.populate(randomSoup(rng, population, reactor.cfg));
  applyMode();
  drawer.reset();
}

/** Push mode/inflow into the world and the URL (applies live, no reset). */
function applyMode(): void {
  const { seed, mode, inflow, refillBy, conserve } = controls.state;
  world.mode = mode;
  world.inflow = inflow;
  world.refillBy = refillBy;
  world.conserve = conserve;
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
  if (conserve) url.searchParams.set("conserve", "1");
  else url.searchParams.delete("conserve");
  history.replaceState(null, "", url);
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
