import { describe, it, expect } from "vitest";
import { parse } from "../src/lambda/parse";
import { print, printCompact } from "../src/lambda/print";
import { familyKey, familySummary, familyTerm } from "../src/chem/family";
import { leadingBinders } from "../src/lambda/term";
import { randomClosedTerm } from "../src/lambda/random";
import { normalize } from "../src/lambda/reduce";
import { mkApp } from "../src/lambda/term";
import { Rng } from "../src/rng";

describe("families", () => {
  it("drops unused leading binders, keeping the order of the used ones", () => {
    expect(print(familyTerm(parse("λxyzu.x (x (λv.x) (λvw.x))")))).toBe("λx.x (x (λy.x) (λyz.x))");
    expect(print(familyTerm(parse("λxyz.z y")))).toBe("λxy.y x");
    expect(print(familyTerm(parse("λxy.x y")))).toBe("λxy.x y");
  });

  it("groups shifted variants and all projections", () => {
    expect(familyKey(parse("λxyzu.x (x (λv.x) (λvw.x))"))).toBe(familyKey(parse("λxyzuv.y (y (λw.y) (λwa.y))")));
    for (const p of ["λx.x", "λxy.x", "λxyz.y", "λxyzuvw.w"]) expect(familyKey(parse(p))).toBe("λx.x");
    expect(familyKey(parse("λxy.y x"))).not.toBe(familyKey(parse("λxy.x y")));
  });

  it("leaves inner binders alone", () => {
    // y is an unused leading binder and goes; the unused inner z stays.
    expect(print(familyTerm(parse("λxy.x (λz.x)")))).toBe("λx.x (λy.x)");
    expect(print(familyTerm(parse("λxy.x (λz.x y)")))).toBe("λxy.x (λz.x y)");
  });

  it("is a closed term in the same family as the original", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 300; i++) {
      const t = randomClosedTerm(rng, 3, 20);
      const f = familyTerm(t);
      expect(f.free).toBe(0);
      expect(familyKey(parse(print(f)))).toBe(familyKey(t));
    }
  });

  it("summarizes species into families", () => {
    const fams = familySummary([
      { term: parse("λxy.x"), count: 3, firstSeen: 5 },
      { term: parse("λxyz.z"), count: 2, firstSeen: 2 },
      { term: parse("λxy.x y"), count: 1, firstSeen: 1 },
    ]);
    const proj = fams.find((f) => f.key === "λx.x")!;
    expect(proj).toMatchObject({ count: 5, species: 2, firstSeen: 2 });
    expect(fams.length).toBe(2);
  });
});

describe("compact printing", () => {
  it("writes unused binders as _ and runs as _ⁿ", () => {
    expect(printCompact(parse("λxyz.y"))).toBe("λ_x_.x");
    expect(printCompact(parse("λxyzuv.u (λwa.z)"))).toBe("λ_²xy_.y (λ_².x)");
    expect(printCompact(parse("λxyzuvw.x y z u v w"))).toBe("λxyzuvw.x y z u v w");
    expect(printCompact(parse("λx.(λy.y) x"))).toBe("λx.(λy.y) x");
  });

  it("shortens long binder runs", () => {
    const names = Array.from({ length: 30 }, (_, i) => `v${i}`);
    const t = parse(`λ${names.join(" ")}.${names[28]} (λa b.${names[27]})`);
    expect(printCompact(t)).toBe("λ_²⁷xy_.y (λ_².x)");
  });

  it("equals the full form when every binder is used", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 300; i++) {
      const t = randomClosedTerm(rng, 3, 16);
      if (!printCompact(t).includes("_")) expect(printCompact(t)).toBe(print(t));
    }
  });
});

describe("leadingBinders", () => {
  it("counts the outer binder run", () => {
    expect(leadingBinders(parse("λxyz.x (λu.u)"))).toBe(3);
    expect(leadingBinders(parse("λx.x"))).toBe(1);
    const kk = normalize(mkApp(parse("λxy.x"), parse("λxy.x")));
    expect(kk.ok && leadingBinders(kk.term)).toBe(3);
  });
});
