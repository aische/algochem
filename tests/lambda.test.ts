import { describe, it, expect } from "vitest";
import { parse } from "../src/lambda/parse";
import { print } from "../src/lambda/print";
import { normalize } from "../src/lambda/reduce";
import { mkApp, isClosed } from "../src/lambda/term";
import { randomClosedTerm, randomNormalTerm } from "../src/lambda/random";
import { Rng } from "../src/rng";

const nf = (src: string) => {
  const r = normalize(parse(src));
  if (!r.ok) throw new Error(`no normal form: ${r.reason}`);
  return r.term;
};

const church = (n: number) => parse(`λf x.${"f (".repeat(n)}x${")".repeat(n)}`);

describe("parse / print", () => {
  it("prints with canonical names", () => {
    expect(print(parse("\\a.\\b.a b"))).toBe("λxy.x y");
    expect(print(parse("λf.(λq.f (q q)) (λq.f (q q))"))).toBe("λx.(λy.x (y y)) (λy.x (y y))");
  });

  it("accepts compact and spaced binder lists", () => {
    expect(parse("λxyz.x z (y z)")).toBe(parse("λx y z.x z (y z)"));
    expect(parse("λxy1.y1")).toBe(parse("λa b.b"));
  });

  it("round-trips through print", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const t = randomClosedTerm(rng, 2, 30);
      expect(parse(print(t))).toBe(t);
    }
  });

  it("parenthesizes lambda arguments and functions", () => {
    expect(print(parse("λx.x (λy.y)"))).toBe("λx.x (λy.y)");
    expect(print(parse("λx.(λy.y) x"))).toBe("λx.(λy.y) x");
    expect(print(parse("λx.x (x x)"))).toBe("λx.x (x x)");
  });

  it("rejects free variables", () => {
    expect(() => parse("λx.y")).toThrow(/Free variable/);
  });
});

describe("hash-consing", () => {
  it("gives alpha-equivalent terms the same identity", () => {
    const a = parse("λa b.a (b b)");
    const b = parse("λp q.p (q q)");
    expect(a).toBe(b);
    expect(a.id).toBe(b.id);
    expect(parse("λa b.b a")).not.toBe(a);
  });
});

describe("normalize", () => {
  it("avoids variable capture", () => {
    // Substituting y under a binder also named y must not capture it.
    expect(nf("λy.(λx y.x) y")).toBe(parse("λa b.a"));
    expect(nf("λy.(λx y.x y) y")).toBe(parse("λa b.a b"));
    expect(nf("λz.(λx y.x y) (λw.z)")).toBe(parse("λa b.a"));
  });

  it("computes Church arithmetic", () => {
    const succ = "(λn f x.f (n f x))";
    const plus = "(λm n f x.m f (n f x))";
    const mult = "(λm n f.m (n f))";
    expect(nf(`${succ} (λf x.f (f x))`)).toBe(church(3));
    expect(nf(`${plus} (λf x.f (f x)) (λf x.f (f (f x)))`)).toBe(church(5));
    expect(nf(`${mult} (λf x.f (f x)) (λf x.f (f (f x)))`)).toBe(church(6));
  });

  it("uses normal order (K I Ω terminates)", () => {
    expect(nf("(λx y.x) (λz.z) ((λw.w w) (λw.w w))")).toBe(parse("λz.z"));
  });

  it("stops Ω at the step limit", () => {
    const r = normalize(parse("(λx.x x) (λx.x x)"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("steps");
  });

  it("stops exploding terms at the size limit", () => {
    // (λx.x x x) (λx.x x x) grows each step.
    const r = normalize(parse("(λx.x x x) (λx.x x x)"));
    expect(r.ok).toBe(false);
  });

  it("returns interned results", () => {
    const i = parse("λx.x");
    const r = normalize(mkApp(i, i));
    expect(r.ok && r.term).toBe(i);
  });
});

describe("randomClosedTerm", () => {
  it("produces closed terms within the size bounds", () => {
    const rng = new Rng(42);
    for (let i = 0; i < 2000; i++) {
      const t = randomClosedTerm(rng, 3, 12);
      expect(isClosed(t)).toBe(true);
      expect(t.size).toBeGreaterThanOrEqual(3);
      expect(t.size).toBeLessThanOrEqual(12);
    }
  });

  it("is deterministic for a seed", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    for (let i = 0; i < 100; i++) {
      expect(randomClosedTerm(a, 3, 12)).toBe(randomClosedTerm(b, 3, 12));
    }
  });
});

describe("randomNormalTerm", () => {
  it("produces closed normal forms within the size bounds", () => {
    const rng = new Rng(42);
    const sizes = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const t = randomNormalTerm(rng, 3, 12);
      expect(isClosed(t)).toBe(true);
      expect(t.size).toBeGreaterThanOrEqual(3);
      expect(t.size).toBeLessThanOrEqual(12);
      const r = normalize(t);
      expect(r.ok && r.steps).toBe(0); // already in normal form
      sizes.add(t.size);
    }
    expect(sizes.size).toBe(10); // every size in 3..12 occurs
  });

  it("respects a tight size range", () => {
    const rng = new Rng(1);
    for (let i = 0; i < 200; i++) expect(randomNormalTerm(rng, 3, 3).size).toBe(3);
  });

  it("is deterministic for a seed", () => {
    const a = new Rng("seed");
    const b = new Rng("seed");
    for (let i = 0; i < 100; i++) expect(randomNormalTerm(a, 3, 12)).toBe(randomNormalTerm(b, 3, 12));
  });
});
