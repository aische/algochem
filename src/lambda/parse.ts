import { type Term, mkApp, mkLam, mkVar, intern } from "./term";

// Grammar:
//   term  := lam | app
//   lam   := ('λ' | '\') binders+ '.' term
//            A binder token splits into one-letter names with optional
//            digits/primes, so `λxy.x` = `λx y.x` and `λxy1.y1` = `λx y1.y1`.
//   app   := atom+ [lam]          (a trailing lambda extends to the right)
//   atom  := ident | '(' term ')'

type Tok = { kind: "lam" | "dot" | "lp" | "rp" | "id"; text: string; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "λ" || c === "\\") {
      toks.push({ kind: "lam", text: c, pos: i++ });
    } else if (c === ".") {
      toks.push({ kind: "dot", text: c, pos: i++ });
    } else if (c === "(") {
      toks.push({ kind: "lp", text: c, pos: i++ });
    } else if (c === ")") {
      toks.push({ kind: "rp", text: c, pos: i++ });
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_']/.test(src[i])) i++;
      toks.push({ kind: "id", text: src.slice(start, i), pos: start });
    } else {
      throw new SyntaxError(`Unexpected '${c}' at ${i}`);
    }
  }
  return toks;
}

/** Parse a closed lambda term. Free variables are an error. Result is interned. */
export function parse(src: string): Term {
  const toks = tokenize(src);
  let p = 0;
  const scope: string[] = []; // innermost binder last

  const peek = (): Tok | undefined => toks[p];
  const expect = (kind: Tok["kind"]): Tok => {
    const t = toks[p];
    if (!t || t.kind !== kind) {
      throw new SyntaxError(`Expected ${kind} at ${t ? t.pos : "end"}`);
    }
    p++;
    return t;
  };

  function term(): Term {
    return peek()?.kind === "lam" ? lam() : app();
  }

  function lam(): Term {
    expect("lam");
    const names: string[] = [];
    while (peek()?.kind === "id") names.push(...toks[p++].text.match(/[A-Za-z_][0-9']*/g)!);
    if (names.length === 0) throw new SyntaxError("λ needs at least one binder");
    expect("dot");
    scope.push(...names);
    let body = term();
    scope.length -= names.length;
    for (let i = 0; i < names.length; i++) body = mkLam(body);
    return body;
  }

  function atom(): Term {
    const t = peek();
    if (!t) throw new SyntaxError("Unexpected end of input");
    if (t.kind === "id") {
      p++;
      const at = scope.lastIndexOf(t.text);
      if (at < 0) throw new SyntaxError(`Free variable '${t.text}' at ${t.pos}`);
      return mkVar(scope.length - 1 - at);
    }
    if (t.kind === "lp") {
      p++;
      const inner = term();
      expect("rp");
      return inner;
    }
    throw new SyntaxError(`Unexpected '${t.text}' at ${t.pos}`);
  }

  function app(): Term {
    let acc = atom();
    for (;;) {
      const t = peek();
      if (!t || t.kind === "rp") return acc;
      if (t.kind === "lam") return mkApp(acc, lam());
      acc = mkApp(acc, atom());
    }
  }

  const result = term();
  if (p !== toks.length) throw new SyntaxError(`Trailing input at ${toks[p].pos}`);
  return intern(result);
}
