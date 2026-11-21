import { describe, it, expect } from "vitest";
import { Reactor, WellMixedSoup } from "../src/chem/soup";
import { parse } from "../src/lambda/parse";
import { print } from "../src/lambda/print";
import { Rng } from "../src/rng";

describe("Reactor", () => {
  it("applies A to B and normalizes", () => {
    const r = new Reactor();
    const k = parse("λx y.x");
    const i = parse("λx.x");
    expect(r.react(k, i)).toBe(parse("λy x.x"));
  });

  it("blocks copy reactions", () => {
    const r = new Reactor();
    const i = parse("λx.x");
    const k = parse("λx y.x");
    expect(r.react(i, k)).toBeNull(); // I K = K is a copy
    expect(r.stats.blockedCopy).toBe(1);
  });

  it("treats non-terminating reactions as elastic", () => {
    const r = new Reactor();
    const w = parse("λx.x x");
    expect(r.react(w, w)).toBeNull();
    expect(r.stats.failedLimit).toBe(1);
  });
});

describe("WellMixedSoup", () => {
  it("keeps the population constant", () => {
    const soup = new WellMixedSoup(new Rng(1), 300);
    for (let i = 0; i < 5000; i++) soup.step();
    expect(soup.molecules.length).toBe(300);
    for (const m of soup.molecules) expect(m.free).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const soup = new WellMixedSoup(new Rng("same"), 200);
      for (let i = 0; i < 3000; i++) soup.step();
      return soup.molecules.map(print).join("|");
    };
    expect(run()).toBe(run());
  });

  it("reduces diversity over time (organizations form)", () => {
    const soup = new WellMixedSoup(new Rng(3), 500);
    const before = soup.speciesCounts().size;
    for (let i = 0; i < 100_000; i++) soup.step();
    const after = soup.speciesCounts().size;
    expect(after).toBeLessThan(before);
  });
});
