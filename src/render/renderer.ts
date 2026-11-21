import type { Term } from "../lambda/term";
import { print, printCompact, truncate } from "../lambda/print";
import type { World, Particle } from "../physics/world";
import { theme } from "./theme";

const FONT_SIZE = 11;
const FONT = `${FONT_SIZE}px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`;
const PAD_X = 3;
const PAD_Y = 2;
const MAX_CHARS = 30;
const GLOW_TIME = 1.2; // seconds a new product glows
const FADE_IN = 0.35;
const FLASH_MS = 450;
const SPRITE_CACHE_MAX = 4000;
const DIM_ALPHA = 0.2; // other species while one is highlighted

/**
 * Color slot of a molecule: -1 plain text, 0..4 a family hue (theme.families),
 * 5 another family (theme.other).
 */
export const PLAIN = -1;
export const OTHER = 5;

/** Which molecules to light up (the rest are dimmed). */
export type Highlight = (t: Term) => boolean;

interface Sprite {
  canvas: HTMLCanvasElement;
  w: number; // CSS px
  h: number;
  lastUsed: number;
}

interface Flash {
  x: number;
  y: number;
  t0: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private sprites = new Map<number, Sprite>();
  /** Show labels in compact form (unused binders as `_`). Call world.remeasure() after changing. */
  compact = false;
  /** Color slot per molecule (see PLAIN / OTHER / FAMILY_COLORS). */
  colorSlot: (t: Term) => number = () => PLAIN;
  private measureCtx: CanvasRenderingContext2D;
  private flashSprite!: HTMLCanvasElement;
  private haloSprite!: HTMLCanvasElement;
  private flashes: Flash[] = [];
  private frame = 0;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.measureCtx = document.createElement("canvas").getContext("2d")!;
    this.measureCtx.font = FONT;
    this.applyTheme();
    this.resize();
  }

  /** Rebuild the cached sprites after the theme changed. */
  applyTheme(): void {
    this.flashSprite = makeGlowSprite(128, theme.flash);
    this.haloSprite = makeGlowSprite(64, theme.halo);
    this.sprites.clear();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    // Sprites are rasterized at the old DPR; rebuild lazily.
    this.sprites.clear();
  }

  /** On-screen box size of a molecule, in CSS px. */
  measure = (t: Term): { w: number; h: number } => {
    const s = this.sprite(t, PLAIN);
    return { w: s.w, h: s.h };
  };

  flash(x: number, y: number, now: number): void {
    this.flashes.push({ x, y, t0: now });
  }

  /**
   * Draw the world; `zoom` < 1 shows more world per screen pixel. When
   * `highlight` is set, the molecules it selects are lit and the rest dimmed.
   */
  draw(world: World, now: number, hovered: Particle | null, zoom = 1, highlight: Highlight | null = null): void {
    this.frame++;
    const { ctx, dpr } = this;
    const W = world.width;
    const H = world.height;

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    if (world.wall) {
      // The middle wall, and the one at the x = 0 seam (screen edges).
      ctx.strokeStyle = theme.wall;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 6 / zoom]);
      ctx.beginPath();
      for (const x of [W / 2, 1 / zoom, W - 1 / zoom]) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Halos behind freshly made products (stretched to the label).
    ctx.globalCompositeOperation = theme.glow;
    for (const p of world.particles) {
      if (highlight !== null && p.dying < 0 && highlight(p.term)) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this.haloSprite, p.x - p.w / 2 - 22, p.y - p.h / 2 - 14, p.w + 44, p.h + 28);
        continue;
      }
      if (p.dying >= 0 || !p.product || p.age >= GLOW_TIME) continue;
      const k = 1 - p.age / GLOW_TIME;
      ctx.globalAlpha = 0.55 * k * k;
      const padX = 18;
      const padY = 12;
      ctx.drawImage(this.haloSprite, p.x - p.w / 2 - padX, p.y - p.h / 2 - padY, p.w + 2 * padX, p.h + 2 * padY);
    }
    ctx.globalCompositeOperation = "source-over";

    // Molecules.
    for (const p of world.particles) {
      const s = this.sprite(p.term, this.colorSlot(p.term));
      let alpha = 1;
      let scale = 1;
      if (p.dying >= 0) {
        const t = world.dyingProgress(p);
        alpha = 1 - t;
        if (p.merge) scale = 1 - 0.6 * t; // consumed reactants shrink into the product
      } else if (p.age < FADE_IN) alpha = p.age / FADE_IN;
      if (highlight !== null) alpha = highlight(p.term) ? alpha : alpha * DIM_ALPHA;
      ctx.globalAlpha = p === hovered ? 1 : alpha;
      this.blitWrapped(s, p.x, p.y, W, H, scale);
    }

    if (hovered) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = theme.hover;
      ctx.lineWidth = 1;
      ctx.strokeRect(hovered.x - hovered.w / 2, hovered.y - hovered.h / 2, hovered.w, hovered.h);
    }

    // Reaction flashes.
    ctx.globalCompositeOperation = theme.glow;
    const live: Flash[] = [];
    for (const f of this.flashes) {
      const t = (now - f.t0) / FLASH_MS;
      if (t >= 1) continue;
      live.push(f);
      const ease = 1 - (1 - t) * (1 - t);
      const size = 30 + 70 * ease;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.drawImage(this.flashSprite, f.x - size / 2, f.y - size / 2, size, size);
    }
    this.flashes = live;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    if (this.sprites.size > SPRITE_CACHE_MAX) this.evictSprites();
  }

  // -------------------------------------------------------------------------

  /** Draw a sprite centered at (x, y), duplicating it across wrapped edges. */
  private blitWrapped(s: Sprite, x: number, y: number, W: number, H: number, scale = 1): void {
    const ctx = this.ctx;
    const w = s.w * scale;
    const h = s.h * scale;
    const left = x - w / 2;
    const top = y - h / 2;
    ctx.drawImage(s.canvas, left, top, w, h);
    const wrapX = left < 0 ? W : left + w > W ? -W : 0;
    const wrapY = top < 0 ? H : top + h > H ? -H : 0;
    if (wrapX) ctx.drawImage(s.canvas, left + wrapX, top, w, h);
    if (wrapY) ctx.drawImage(s.canvas, left, top + wrapY, w, h);
    if (wrapX && wrapY) ctx.drawImage(s.canvas, left + wrapX, top + wrapY, w, h);
  }

  private sprite(t: Term, slot: number): Sprite {
    // One sprite per species, label style and color.
    const key = t.id * 16 + (this.compact ? 8 : 0) + (slot + 1);
    let s = this.sprites.get(key);
    if (!s) {
      const text = truncate(this.compact ? printCompact(t) : print(t), MAX_CHARS);
      const w = Math.ceil(this.measureCtx.measureText(text).width) + PAD_X * 2;
      const h = Math.ceil(FONT_SIZE * 1.3) + PAD_Y * 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * this.dpr);
      canvas.height = Math.ceil(h * this.dpr);
      const c = canvas.getContext("2d")!;
      c.scale(this.dpr, this.dpr);
      c.font = FONT;
      c.textBaseline = "middle";
      c.fillStyle = slot === PLAIN ? theme.text : slot === OTHER ? theme.other : theme.families[slot];
      c.fillText(text, PAD_X, h / 2 + 0.5);
      s = { canvas, w, h, lastUsed: this.frame };
      this.sprites.set(key, s);
    }
    s.lastUsed = this.frame;
    return s;
  }

  private evictSprites(): void {
    for (const [id, s] of this.sprites) {
      if (s.lastUsed < this.frame - 1) this.sprites.delete(id);
    }
  }
}

/** Radial glow: the reaction flash, or the halo stretched behind a new molecule. */
function makeGlowSprite(size: number, stops: readonly [number, string][]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
