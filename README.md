# AlgoChem: a lambda soup

<!-- help:start (this part is also shown in the app's help overlay) -->

An algorithmic chemistry you can watch. Hundreds of lambda-calculus expressions drift around the screen as text. When two of them bump into each other, they can react: one is applied to the other as a function, and the result is reduced to normal form. Over time the soup loses variety and settles into groups of expressions that keep producing each other.

It's based on Walter Fontana and Leo Buss's *AlChemy*.

## How a reaction works

When molecules **A** and **B** collide, they react with some probability. One of them is picked at random to act as the function, and the product is:

```
C = normalize(A B)
```

Normalization uses normal-order reduction, with limits on the number of steps and on term size. If a reaction doesn't finish within those limits, nothing happens and the two molecules just bounce off each other. What happens to A and B afterwards depends on the mode.

Expressions use canonical variable names, so equivalent terms always look the same, e.g. `λxyz.x z (y z)`.

## Modes

### Reaction

| Mode | Rule | Number of molecules |
|---|---|---|
| **Catalytic** (default) | A + B → A + B + C | Stays constant |
| **Consumptive** | A + B → C | Depends on inflow |

- **Catalytic** is classic AlChemy. A and B survive the reaction, and the product C is added to the soup. To keep the count constant, a random molecule near the reaction is removed. Products that equal A or B are blocked; without that rule, copying functions like the identity take over.
- **Consumptive** is closer to real chemistry: A and B are used up and shrink into the product. Each reaction removes one molecule overall.

### Inflow (consumptive mode only)

- **Off:** the soup shrinks with every reaction until the few remaining molecules rarely meet. It's a run with an end.
- **On, by count:** fresh random molecules flow in to keep the starting number of molecules.
- **On, by mass:** fresh molecules flow in to keep the starting total *size* of all expressions, measured in syntax-tree nodes. The number of molecules floats, up to twice the starting count.

### Conserve mass

An on/off setting that works with every mode. The **mass** of a molecule is the number of nodes in its syntax tree. Mass in the soup plus a pool of free mass stays exactly constant. The pool starts at 20% of the soup's mass.

- Reactions that shrink expressions put mass into the pool. For example, `λxy.x` applied to two arguments throws the second one away.
- Reactions that grow expressions have to take mass from the pool. If the pool doesn't have enough, the reaction doesn't happen.
- Inflow builds new molecules out of the pool.

The gauge in the panel shows the free mass and the total. With conservation on, large products and duplication become costly, so species compete for a limited supply.

## Controls

| Control | |
|---|---|
| Drag | Stir the soup |
| Hover a molecule | Show the full expression and how many copies exist |
| `Space` | Pause / play |
| `R` | Reset (same seed gives the same starting soup) |
| `L` | Species list |
| `H` | Hide the panel |
| `?` | This help |

The panel also has the simulation speed (0.25× to 8×), the starting number of molecules (applied on reset) and the seed.

**Species list.** A side panel listing every distinct expression with its count, sorted by count or by newest. Hover a row to highlight all its copies in the soup; click to keep the highlight.

## URL parameters

The page keeps its settings in the URL, so a link reproduces a setup:

| Parameter | Meaning |
|---|---|
| `seed=abc` | Random seed |
| `n=800` | Starting number of molecules (300–1000) |
| `mode=consumptive` | Consumptive reactions |
| `inflow=0` | No inflow (consumptive mode) |
| `refill=mass` | Inflow restores mass instead of count |
| `conserve=1` | Conserve mass |
| `perf` | Log timing and soup statistics to the console |

Example: `?seed=demo&mode=consumptive&refill=mass&conserve=1`

<!-- help:end -->

## Running it

```sh
npm install
npm run dev       # development server
npm test          # unit tests
npm run build     # static site in dist/
```

The build uses relative paths, so `dist/` can be served from any folder on any static web server.

## Code layout

```
src/lambda/   terms, parser, printer, reduction, random term generator
src/chem/     reaction rule and reaction cache
src/physics/  movement, collisions, modes, inflow, mass bookkeeping
src/render/   canvas drawing, glow and flash effects
src/ui/       control panel, species list
tests/        unit tests (Vitest)
```

Design notes and findings are in `.notes/spec.md`.
