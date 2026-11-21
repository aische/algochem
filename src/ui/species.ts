import type { World } from "../physics/world";
import type { Term } from "../lambda/term";
import { print, printCompact } from "../lambda/print";
import { familyKey, familySummary } from "../chem/family";
import type { Highlight } from "../render/renderer";

export type SortMode = "count" | "newest" | "families";

const REFRESH_MS = 1000;

/** Display settings the drawer follows. */
export interface DrawerView {
  compact: boolean;
  /** Color of a family (by key), or null when it has none. */
  colorOf(familyKey: string): string | null;
}

interface Row {
  el: HTMLLIElement;
  count: HTMLSpanElement;
  meta: HTMLSpanElement;
  bar: HTMLSpanElement;
  swatch: HTMLElement;
  text: string;
}

/** One list entry: a species or, in the families view, a family. */
interface Entry {
  /** Row key: "s<species id>" or "f<family key>". */
  key: string;
  term: Term;
  count: number;
  firstSeen: number;
  family: string;
  /** Families view: number of species in the family. */
  species?: number;
}

/**
 * Side drawer listing every species (or family) in the soup with its count.
 * Hovering a row highlights its molecules in the soup; clicking pins the
 * highlight. The list refreshes about once a second and holds still while
 * the pointer is over it, so rows can be read and hovered.
 */
export class SpeciesDrawer {
  isOpen = false;
  sort: SortMode = "count";

  private root: HTMLElement;
  private list: HTMLOListElement;
  private summary: HTMLElement;
  private tip: HTMLElement;
  private rows = new Map<string, Row>();
  private hoveredKey: string | null = null;
  private pinnedKey: string | null = null;
  private pointerInside = false;
  private lastRefresh = -Infinity;

  constructor(
    parent: HTMLElement,
    private getWorld: () => World,
    private view: DrawerView,
  ) {
    this.root = document.createElement("aside");
    this.root.className = "drawer";
    this.root.innerHTML = `
      <header>
        <div class="title-row">
          <h2>Species</h2>
          <button class="close" title="Close (L)">×</button>
        </div>
        <div class="summary"></div>
        <div class="seg">
          <button data-sort="count" class="on">By count</button>
          <button data-sort="newest">Newest</button>
          <button data-sort="families" title="Species that differ only in unused leading binders, grouped">Families</button>
        </div>
      </header>
      <ol class="species-list"></ol>
    `;
    parent.appendChild(this.root);
    this.tip = document.createElement("div");
    this.tip.className = "row-tip";
    this.tip.hidden = true;
    parent.appendChild(this.tip);

    this.root.addEventListener("click", (e) => {
      if (e.target instanceof HTMLButtonElement) e.target.blur(); // keep Space for pause
    });
    this.list = this.root.querySelector("ol")!;
    this.summary = this.root.querySelector(".summary")!;
    this.root.querySelector(".close")!.addEventListener("click", () => this.toggle(false));

    for (const b of this.root.querySelectorAll<HTMLButtonElement>("[data-sort]")) {
      b.addEventListener("click", () => {
        const grouping = (this.sort === "families") !== (b.dataset.sort === "families");
        this.sort = b.dataset.sort as SortMode;
        for (const o of this.root.querySelectorAll("[data-sort]")) o.classList.toggle("on", o === b);
        this.list.scrollTop = 0;
        if (grouping) this.clearRows(); // species rows and family rows are different things
        this.refresh();
      });
    }

    this.list.addEventListener("pointerenter", () => (this.pointerInside = true));
    this.list.addEventListener("pointerleave", () => {
      this.pointerInside = false;
      this.setHovered(null);
    });
    this.list.addEventListener("pointerover", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (li) this.setHovered(li.dataset.key!);
    });
    this.list.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (!li) return;
      const key = li.dataset.key!;
      this.setPinned(this.pinnedKey === key ? null : key);
    });
    this.list.addEventListener("scroll", () => (this.tip.hidden = true));
  }

  /** Molecules to highlight in the soup, if any. */
  get highlight(): Highlight | null {
    if (!this.isOpen) return null;
    const key = this.hoveredKey ?? this.pinnedKey;
    if (key === null) return null;
    const rest = key.slice(1);
    if (key[0] === "f") return (t) => familyKey(t) === rest;
    const id = Number(rest);
    return (t) => t.id === id;
  }

  toggle(open = !this.isOpen): void {
    this.isOpen = open;
    this.root.classList.toggle("open", open);
    document.body.classList.toggle("drawer-open", open);
    if (open) this.refresh();
    else {
      this.setHovered(null);
      this.setPinned(null);
    }
  }

  /** Call after the world is replaced or the label style changed. */
  reset(): void {
    this.clearRows();
    if (this.isOpen) this.refresh();
  }

  /** Call once per frame. */
  tick(now: number): void {
    if (this.isOpen && !this.pointerInside && now - this.lastRefresh >= REFRESH_MS) this.refresh();
  }

  // -------------------------------------------------------------------------

  private clearRows(): void {
    this.setPinned(null);
    this.setHovered(null);
    for (const r of this.rows.values()) r.el.remove();
    this.rows.clear();
  }

  private entries(): { entries: Entry[]; species: number; families: number; total: number } {
    const world = this.getWorld();
    const species = world.speciesSummary();
    const families = familySummary(species);
    const total = species.reduce((n, s) => n + s.count, 0);
    const entries: Entry[] =
      this.sort === "families"
        ? families.map((f) => ({
            key: "f" + f.key,
            term: f.term,
            count: f.count,
            firstSeen: f.firstSeen,
            family: f.key,
            species: f.species,
          }))
        : species.map((s) => ({
            key: "s" + s.term.id,
            term: s.term,
            count: s.count,
            firstSeen: s.firstSeen,
            family: familyKey(s.term),
          }));
    return { entries, species: species.length, families: families.length, total };
  }

  private refresh(): void {
    this.lastRefresh = performance.now();
    const world = this.getWorld();
    const { entries, species, families, total } = this.entries();
    const byCount = (a: Entry, b: Entry) => b.count - a.count || (a.key < b.key ? -1 : 1);
    entries.sort(this.sort === "newest" ? (a, b) => b.firstSeen - a.firstSeen || byCount(a, b) : byCount);
    const maxCount = entries.reduce((m, s) => Math.max(m, s.count), 1);

    this.summary.textContent = `${species} species · ${families} families · ${total} molecules`;

    const live = new Set<string>();
    for (const e of entries) {
      live.add(e.key);
      let row = this.rows.get(e.key);
      if (!row) row = this.makeRow(e.key, this.view.compact ? printCompact(e.term) : print(e.term));
      row.count.textContent = String(e.count);
      row.meta.textContent =
        this.sort === "newest"
          ? formatAge(world.time - e.firstSeen)
          : this.sort === "families"
            ? `${e.species} sp`
            : `${((100 * e.count) / total).toFixed(1)}%`;
      row.bar.style.width = `${(100 * e.count) / maxCount}%`;
      const color = this.view.colorOf(e.family);
      row.swatch.style.background = color ?? "transparent";
      this.list.appendChild(row.el); // moves existing rows into sorted order
    }
    for (const [key, row] of this.rows) {
      if (!live.has(key)) {
        row.el.remove();
        this.rows.delete(key);
      }
    }
    if (this.pinnedKey !== null && !live.has(this.pinnedKey)) this.setPinned(null);
  }

  private makeRow(key: string, text: string): Row {
    const el = document.createElement("li");
    el.dataset.key = key;
    el.innerHTML = `<span class="bar"></span><span class="count"></span><span class="term"><i class="sw"></i><span></span></span><span class="meta"></span>`;
    const termEl = el.querySelector<HTMLSpanElement>(".term")!;
    termEl.lastElementChild!.textContent = text;
    el.addEventListener("pointerenter", () => {
      // Full term beside the drawer, only when the row truncates it.
      if (termEl.scrollWidth <= termEl.clientWidth) return;
      const r = el.getBoundingClientRect();
      this.tip.textContent = text;
      this.tip.hidden = false;
      const tr = this.tip.getBoundingClientRect();
      this.tip.style.transform = `translate(${r.left - tr.width - 10}px, ${Math.min(r.top, window.innerHeight - tr.height - 8)}px)`;
    });
    el.addEventListener("pointerleave", () => (this.tip.hidden = true));
    const row: Row = {
      el,
      count: el.querySelector(".count")!,
      meta: el.querySelector(".meta")!,
      bar: el.querySelector(".bar")!,
      swatch: el.querySelector(".sw")!,
      text,
    };
    if (key === this.pinnedKey) el.classList.add("pinned");
    this.rows.set(key, row);
    return row;
  }

  private setHovered(key: string | null): void {
    this.hoveredKey = key;
    if (key === null) this.tip.hidden = true;
  }

  private setPinned(key: string | null): void {
    if (this.pinnedKey !== null) this.rows.get(this.pinnedKey)?.el.classList.remove("pinned");
    this.pinnedKey = key;
    if (key !== null) this.rows.get(key)?.el.classList.add("pinned");
  }
}

function formatAge(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
