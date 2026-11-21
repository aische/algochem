import { describe, it, expect } from "vitest";
import { Reactor, randomSoup } from "../src/chem/soup";
import { World, type ReactionMode, type ReactionEvent } from "../src/physics/world";
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
