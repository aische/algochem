import type { World, SpeciesInfo } from "../physics/world";
import { print } from "../lambda/print";

export type SortMode = "count" | "newest";

const REFRESH_MS = 1000;

interface Row {
  el: HTMLLIElement;
  count: HTMLSpanElement;
  meta: HTMLSpanElement;
  bar: HTMLSpanElement;
  text: string;
}

/**
 * Side drawer listing every species in the soup with its count. Hovering a
 * row highlights that species in the soup; clicking pins the highlight.
 * The list refreshes about once a second and holds still while the pointer
 * is over it, so rows can be read and hovered.
 */
export class SpeciesDrawer {
  isOpen = false;
  sort: SortMode = "count";

  private root: HTMLElement;
  private list: HTMLOListElement;
  private summary: HTMLElement;
  private tip: HTMLElement;
  private rows = new Map<number, Row>();
  private hoveredId: number | null = null;
  private pinnedId: number | null = null;
  private pointerInside = false;
  private lastRefresh = -Infinity;

  constructor(
    parent: HTMLElement,
    private getWorld: () => World,
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
        this.sort = b.dataset.sort as SortMode;
        for (const o of this.root.querySelectorAll("[data-sort]")) o.classList.toggle("on", o === b);
        this.list.scrollTop = 0;
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
      if (li) this.setHovered(Number(li.dataset.id));
    });
    this.list.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (!li) return;
      const id = Number(li.dataset.id);
      this.setPinned(this.pinnedId === id ? null : id);
    });
    this.list.addEventListener("scroll", () => this.tip.hidden = true);
  }

  /** Species id to highlight in the soup, if any. */
  get highlight(): number | null {
    return this.isOpen ? (this.hoveredId ?? this.pinnedId) : null;
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

  /** Call after the world is replaced. */
  reset(): void {
    this.setPinned(null);
    this.setHovered(null);
    for (const r of this.rows.values()) r.el.remove();
    this.rows.clear();
    if (this.isOpen) this.refresh();
  }

  /** Call once per frame. */
  tick(now: number): void {
    if (this.isOpen && !this.pointerInside && now - this.lastRefresh >= REFRESH_MS) this.refresh();
  }

  // -------------------------------------------------------------------------

  private refresh(): void {
    this.lastRefresh = performance.now();
    const world = this.getWorld();
    const species = world.speciesSummary();
    const total = species.reduce((n, s) => n + s.count, 0);
    const byCount = (a: SpeciesInfo, b: SpeciesInfo) => b.count - a.count || a.term.id - b.term.id;
    species.sort(
      this.sort === "count" ? byCount : (a, b) => b.firstSeen - a.firstSeen || byCount(a, b),
    );
    const maxCount = species.reduce((m, s) => Math.max(m, s.count), 1);

    this.summary.textContent = `${species.length} species · ${total} molecules`;

    const live = new Set<number>();
    for (const s of species) {
      const id = s.term.id;
      live.add(id);
      let row = this.rows.get(id);
      if (!row) row = this.makeRow(id, print(s.term));
      row.count.textContent = String(s.count);
      row.meta.textContent =
        this.sort === "count" ? `${((100 * s.count) / total).toFixed(1)}%` : formatAge(world.time - s.firstSeen);
      row.bar.style.width = `${(100 * s.count) / maxCount}%`;
      this.list.appendChild(row.el); // moves existing rows into sorted order
    }
    for (const [id, row] of this.rows) {
      if (!live.has(id)) {
        row.el.remove();
        this.rows.delete(id);
      }
    }
    if (this.pinnedId !== null && !live.has(this.pinnedId)) this.setPinned(null);
  }

  private makeRow(id: number, text: string): Row {
    const el = document.createElement("li");
    el.dataset.id = String(id);
    el.innerHTML = `<span class="bar"></span><span class="count"></span><span class="term"></span><span class="meta"></span>`;
    const termEl = el.querySelector<HTMLSpanElement>(".term")!;
    termEl.textContent = text;
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
      text,
    };
    if (id === this.pinnedId) el.classList.add("pinned");
    this.rows.set(id, row);
    return row;
  }

  private setHovered(id: number | null): void {
    this.hoveredId = id;
    if (id === null) this.tip.hidden = true;
  }

  private setPinned(id: number | null): void {
    if (this.pinnedId !== null) this.rows.get(this.pinnedId)?.el.classList.remove("pinned");
    this.pinnedId = id;
    if (id !== null) this.rows.get(id)?.el.classList.add("pinned");
  }
}

function formatAge(s: number): string {
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
