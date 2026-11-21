import { describe, it, expect } from "vitest";
import { Reactor, randomSoup } from "../src/chem/soup";
import { World, DEFAULT_WORLD, type ReactionMode, type ReactionEvent } from "../src/physics/world";
import { Rng } from "../src/rng";

// Fixed-size boxes keep the test independent of fonts.
const measure = () => ({ w: 60, h: 16 });

function makeWorld(mode: ReactionMode, inflow: boolean, n = 300) {
  const rng = new Rng(11);
  const world = new World(900, 600, rng, new Reactor(), measure);
  world.populate(randomSoup(rng, n));
  world.mode = mode;
  world.inflow = inflow;
  return world;
}

function run(world: World, steps: number) {
  const events: ReactionEvent[] = [];
  for (let i = 0; i < steps; i++) world.step(1 / 60, events);
  return events.length;
}

describe("World population", () => {
  it("catalytic: constant, reactants survive", () => {
    const w = makeWorld("catalytic", false);
    const reactions = run(w, 1500);
    expect(reactions).toBeGreaterThan(50);
    expect(w.aliveCount()).toBe(300);
  });

  it("consumptive without inflow: shrinks by one per reaction", () => {
    const w = makeWorld("consumptive", false);
    const reactions = run(w, 1500);
    expect(reactions).toBeGreaterThan(50);
    expect(w.aliveCount()).toBe(300 - reactions);
  });

  it("consumptive with inflow: refills to the initial size", () => {
    const w = makeWorld("consumptive", true);
    const reactions = run(w, 1500);
    expect(reactions).toBeGreaterThan(50);
    expect(w.aliveCount()).toBe(300);
  });

  it("switching modes live keeps the current population", () => {
    const w = makeWorld("consumptive", false);
    run(w, 600);
    const shrunk = w.aliveCount();
    expect(shrunk).toBeLessThan(300);
    w.mode = "catalytic";
    run(w, 600);
    expect(w.aliveCount()).toBe(shrunk);
    w.mode = "consumptive";
    w.inflow = true;
    run(w, 600);
    expect(w.aliveCount()).toBe(300);
  });

  it("consumed reactants merge into the product, then disappear", () => {
    const w = makeWorld("consumptive", false);
    const events: ReactionEvent[] = [];
    while (events.length === 0) w.step(1 / 60, events);
    const merging = w.particles.filter((p) => p.merge);
    expect(merging.length).toBe(2 * events.length);
    run(w, 30); // > mergeTime
    for (const p of merging) expect(w.particles).not.toContain(p);
  });
});

describe("World mass conservation", () => {
  const total = (w: World) => w.soupMass() + w.pool;
  const setups: [ReactionMode, boolean][] = [
    ["catalytic", false],
    ["consumptive", true],
    ["consumptive", false],
  ];

  for (const [mode, inflow] of setups) {
    it(`keeps soup mass + pool constant (${mode}${mode === "consumptive" ? (inflow ? " + inflow" : ", no inflow") : ""})`, () => {
      const w = makeWorld(mode, inflow);
      w.conserve = true;
      const start = total(w);
      expect(w.pool).toBe(Math.round(w.soupMass() * 0.2));
      const events: ReactionEvent[] = [];
      for (let i = 0; i < 1500; i++) {
        w.step(1 / 60, events);
        expect(total(w)).toBe(start);
        expect(w.pool).toBeGreaterThanOrEqual(0);
      }
      expect(events.length).toBeGreaterThan(50);
    });
  }

  it("refuses reactions the pool cannot pay for", () => {
    const w = makeWorld("catalytic", false);
    w.conserve = true;
    w.pool = 0;
    run(w, 1500);
    expect(w.starved).toBeGreaterThan(0);
    expect(w.pool).toBeGreaterThanOrEqual(0);
  });

  it("inflow is built from free mass and stops when it runs out", () => {
    // No reactions, so only inflow touches the pool.
    const rng = new Rng(3);
    const w = new World(900, 600, rng, new Reactor(), measure, { ...DEFAULT_WORLD, pReact: 0 });
    w.populate(randomSoup(rng, 300));
    w.mode = "consumptive";
    w.inflow = true;
    w.conserve = true;
    w.target = 400; // wants 100 more molecules
    w.pool = 0;
    run(w, 60);
    expect(w.aliveCount()).toBe(300); // nothing to build them from

    w.pool = 100;
    run(w, 120);
    const added = w.aliveCount() - 300;
    expect(added).toBeGreaterThan(5);
    expect(added).toBeLessThan(100);
    expect(w.pool).toBeLessThan(3); // spent down to less than the smallest molecule
  });

  it("without conservation the pool is untouched", () => {
    const w = makeWorld("catalytic", false);
    const pool = w.pool;
    run(w, 600);
    expect(w.pool).toBe(pool);
  });
});

describe("Inflow refill by mass", () => {
  it("restores the initial soup mass while the count floats", () => {
    const w = makeWorld("consumptive", true);
    w.refillBy = "mass";
    const startMass = w.soupMass();
    const counts = new Set<number>();
    const events: ReactionEvent[] = [];
    for (let i = 0; i < 1500; i++) {
      w.step(1 / 60, events);
      counts.add(w.aliveCount());
    }
    expect(events.length).toBeGreaterThan(50);
    // Within one fresh molecule (max 12 nodes) plus what was consumed this step.
    expect(Math.abs(w.soupMass() - startMass)).toBeLessThan(60);
    expect(w.aliveCount()).not.toBe(300); // count is no longer what's held fixed
    expect(counts.size).toBeGreaterThan(5);
    expect(w.aliveCount()).toBeLessThanOrEqual(600); // capped at 2× initial
  });

  it("still conserves total mass when conservation is on", () => {
    const w = makeWorld("consumptive", true);
    w.refillBy = "mass";
    w.conserve = true;
    const start = w.soupMass() + w.pool;
    const events: ReactionEvent[] = [];
    for (let i = 0; i < 1500; i++) {
      w.step(1 / 60, events);
      expect(w.soupMass() + w.pool).toBe(start);
    }
    // Inflow turns spare free mass back into molecules: pool settles near its start.
    expect(w.pool).toBeLessThan(start * 0.3);
  });
});
