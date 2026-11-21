import type { Term } from "../lambda/term";
import { print, truncate } from "../lambda/print";
import type { World, Particle } from "../physics/world";

const FONT_SIZE = 11;
const FONT = `${FONT_SIZE}px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`;
const PAD_X = 3;
const PAD_Y = 2;
const MAX_CHARS = 30;
const TEXT_COLOR = "rgba(214, 222, 235, 0.86)";
const BG = "#06080d";
const GLOW_TIME = 1.2; // seconds a new product glows
const FADE_IN = 0.35;
const FLASH_MS = 450;
const SPRITE_CACHE_MAX = 4000;

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
  private measureCtx: CanvasRenderingContext2D;
  private flashSprite: HTMLCanvasElement;
  private haloSprite: HTMLCanvasElement;
  private flashes: Flash[] = [];
  private frame = 0;
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.measureCtx = document.createElement("canvas").getContext("2d")!;
    this.measureCtx.font = FONT;
    this.flashSprite = makeFlashSprite();
    this.haloSprite = makeHaloSprite();
    this.resize();
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
    const s = this.sprite(t);
    return { w: s.w, h: s.h };
  };

  flash(x: number, y: number, now: number): void {
    this.flashes.push({ x, y, t0: now });
  }

  /** Draw the world; `zoom` < 1 shows more world per screen pixel. */
  draw(world: World, now: number, hovered: Particle | null, zoom = 1): void {
    this.frame++;
    const { ctx, dpr } = this;
    const W = world.width;
    const H = world.height;

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // Halos behind freshly made products (additive, stretched to the label).
    ctx.globalCompositeOperation = "lighter";
    for (const p of world.particles) {
      if (p.dying >= 0 || p.age >= GLOW_TIME) continue;
      const k = 1 - p.age / GLOW_TIME;
      ctx.globalAlpha = 0.55 * k * k;
      const padX = 18;
      const padY = 12;
      ctx.drawImage(this.haloSprite, p.x - p.w / 2 - padX, p.y - p.h / 2 - padY, p.w + 2 * padX, p.h + 2 * padY);
    }
    ctx.globalCompositeOperation = "source-over";

    // Molecules.
    for (const p of world.particles) {
      const s = this.sprite(p.term);
      let alpha = 1;
      if (p.dying >= 0) alpha = Math.max(0, 1 - p.dying / world.cfg.dissolveTime);
      else if (p.age < FADE_IN) alpha = p.age / FADE_IN;
      ctx.globalAlpha = p === hovered ? 1 : alpha;
      this.blitWrapped(s, p.x, p.y, W, H);
    }

    if (hovered) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(120, 220, 255, 0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(hovered.x - hovered.w / 2, hovered.y - hovered.h / 2, hovered.w, hovered.h);
    }

    // Reaction flashes, additive.
    ctx.globalCompositeOperation = "lighter";
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
  private blitWrapped(s: Sprite, x: number, y: number, W: number, H: number): void {
    const ctx = this.ctx;
    const left = x - s.w / 2;
    const top = y - s.h / 2;
    ctx.drawImage(s.canvas, left, top, s.w, s.h);
    const wrapX = left < 0 ? W : left + s.w > W ? -W : 0;
    const wrapY = top < 0 ? H : top + s.h > H ? -H : 0;
    if (wrapX) ctx.drawImage(s.canvas, left + wrapX, top, s.w, s.h);
    if (wrapY) ctx.drawImage(s.canvas, left, top + wrapY, s.w, s.h);
    if (wrapX && wrapY) ctx.drawImage(s.canvas, left + wrapX, top + wrapY, s.w, s.h);
  }

  private sprite(t: Term): Sprite {
    let s = this.sprites.get(t.id);
    if (!s) {
      const text = truncate(print(t), MAX_CHARS);
      const w = Math.ceil(this.measureCtx.measureText(text).width) + PAD_X * 2;
      const h = Math.ceil(FONT_SIZE * 1.3) + PAD_Y * 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(w * this.dpr);
      canvas.height = Math.ceil(h * this.dpr);
      const c = canvas.getContext("2d")!;
      c.scale(this.dpr, this.dpr);
      c.font = FONT;
      c.textBaseline = "middle";
      c.fillStyle = TEXT_COLOR;
      c.fillText(text, PAD_X, h / 2 + 0.5);
      s = { canvas, w, h, lastUsed: this.frame };
      this.sprites.set(t.id, s);
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

function makeFlashSprite(): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255, 255, 240, 1)");
  grad.addColorStop(0.15, "rgba(255, 220, 140, 0.85)");
  grad.addColorStop(0.45, "rgba(255, 140, 60, 0.25)");
  grad.addColorStop(1, "rgba(255, 80, 40, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Soft cyan glow; drawn stretched behind a newly formed molecule. */
function makeHaloSprite(): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(120, 220, 255, 0.9)");
  grad.addColorStop(0.5, "rgba(80, 180, 255, 0.35)");
  grad.addColorStop(1, "rgba(60, 140, 255, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}
