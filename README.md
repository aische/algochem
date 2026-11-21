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

The starting soup, inflow and random drops use random expressions of 3–12 nodes, already reduced to normal form.

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

### Max leading binders

Off by default. Applying `λxy.x` to an expression T gives `λy.T`: T with one more binder in front that nothing uses. Repeated reactions like this grow long runs of unused binders, up to the 200-node size limit. This setting refuses any product with more than 6, 8 or 12 leading binders; the reaction is then elastic. It changes the chemistry, so a run with a limit is no longer classic AlChemy. It keeps expressions short, but in test runs it did not make the soup settle faster.

## Families

Many species are the same expression with a different number of unused binders in front, like `λxyzu.x (x (λv.x))` and `λxyzuv.y (y (λw.y))`. A **family** groups them: drop the unused leading binders and both become `λx.x (x (λy.x))`. All projections (`λxy.x`, `λxyz.y`, …) are one family, `λx.x`.

The species count can stay in the hundreds while nearly all molecules belong to a handful of families. The panel's sparkline shows both counts since the last reset, species in blue and families in orange, on a log scale. Hover it to read a point in time.

Three optional views, all off by default:

- **Families** tab in the species list: one row per family, with its molecule count and number of species.
- **Compact labels:** unused binders print as `_`, a run of n as `_ⁿ`, and only used binders get names. `λxyzuv.u (λwa.z)` becomes `λ_²xy_.y (λ_².x)`. Hovering a molecule still shows the full expression.
- **Color by family:** the five largest families get their own color, all others are gray. A family keeps its color as long as it stays among the five largest.

## Split soup and the wall

Tick **split** and reset: the left half starts from the seed and the right half from a second seed, with a wall between them (and one at the screen edge, since the soup wraps around). Nothing crosses or reacts across the wall. Let both halves settle into their own families, then press **Remove wall** and watch them meet. With color by family on, you can see whether one side takes over, both mix, or the boundary holds.

## Dropping molecules

Shift-click the soup to drop 10 molecules at that spot: copies of the expression typed in the **shift-click drops** field, or random ones if it's empty. Use it to see whether an organization absorbs newcomers or gets taken over. In catalytic mode each dropped molecule displaces a nearby one, so the count holds. With conservation on, drops are paid for from the pool.

## Controls

| Control | |
|---|---|
| Drag | Stir the soup |
| Shift-click | Drop 10 molecules |
| Hover a molecule | Show the full expression and how many copies exist |
| `Space` | Pause / play |
| `R` | Reset (same seed gives the same starting soup) |
| `L` | Species list |
| `T` | Light / dark theme |
| `H` | Hide the panel (the corner button brings it back) |
| `?` | This help |

The panel also has the simulation speed (0.25× to 8×), the starting number of molecules (applied on reset) and the seed.

**Mixing** (0.25× to 8×) sets how fast molecules wander. Low mixing lets regions evolve their own organizations side by side. High mixing comes closer to a well-mixed soup, where everything meets everything.

**Species list.** A side panel listing every distinct expression with its count, sorted by count or by newest, or grouped into families. Hover a row to highlight all its copies (or the whole family) in the soup; click to keep the highlight.

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
| `binders=8` | Max leading binders (6, 8 or 12) |
| `mix=2` | Mixing (0.25–8) |
| `split=xyz` | Split soup; the right half's seed |
| `compact=1` | Compact labels |
| `color=1` | Color by family |
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
src/chem/     reaction rule, reaction cache, families
src/physics/  movement, collisions, modes, inflow, mass bookkeeping
src/render/   canvas drawing, glow and flash effects, family colors
src/ui/       control panel, sparkline, species list
tests/        unit tests (Vitest)
```

Design notes and findings are in `.notes/spec.md`.
