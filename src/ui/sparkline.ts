import { theme } from "../render/theme";

/** One sample of the soup's diversity. */
export interface Sample {
  /** Sim time (s). */
  t: number;
  species: number;
  families: number;
}

const MAX_POINTS = 240;
const FIRST_INTERVAL = 1; // sim seconds

/**
 * Species and family counts since the last reset. Always covers the whole
 * run: when the buffer fills, every other sample is dropped and the sampling
 * interval doubles.
 */
export class History {
  samples: Sample[] = [];
  interval = FIRST_INTERVAL;

  /** True when a sample is due at sim time `t`. */
  due(t: number): boolean {
    const last = this.samples[this.samples.length - 1];
    return !last || t - last.t >= this.interval;
  }

  push(s: Sample): void {
    this.samples.push(s);
    if (this.samples.length > MAX_POINTS) {
      this.samples = this.samples.filter((_, i) => i % 2 === 0 || i === this.samples.length - 1);
      this.interval *= 2;
    }
  }

  reset(): void {
    this.samples = [];
    this.interval = FIRST_INTERVAL;
  }
}

export const speciesColor = () => theme.families[0];
export const familiesColor = () => theme.families[1];

/**
 * Two lines on one log-scaled count axis (1 at the bottom, the run's highest
 * count at the top), so the species and the much smaller family count both
 * keep their shape. Returns the sample index nearest to `hoverX`, if given.
 */
export function drawSparkline(canvas: HTMLCanvasElement, samples: Sample[], hoverX: number | null): number | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Recessive baseline.
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
  if (samples.length < 2) return null;

  const pad = 3;
  const max = Math.max(2, ...samples.map((s) => s.species));
  const tMax = samples[samples.length - 1].t || 1;
  const x = (s: Sample) => (s.t / tMax) * (w - 2 * pad) + pad;
  const y = (v: number) => h - pad - (Math.log(Math.max(1, v)) / Math.log(max)) * (h - 2 * pad);

  let hover: number | null = null;
  if (hoverX !== null) {
    let best = Infinity;
    samples.forEach((s, i) => {
      const d = Math.abs(x(s) - hoverX);
      if (d < best) {
        best = d;
        hover = i;
      }
    });
  }
  if (hover !== null) {
    ctx.strokeStyle = theme.gridStrong;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(samples[hover])) + 0.5, 0);
    ctx.lineTo(Math.round(x(samples[hover])) + 0.5, h);
    ctx.stroke();
  }

  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (const [key, color] of [
    ["families", familiesColor()],
    ["species", speciesColor()],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    samples.forEach((s, i) => (i ? ctx.lineTo(x(s), y(s[key])) : ctx.moveTo(x(s), y(s[key]))));
    ctx.stroke();
    if (hover !== null) {
      const s = samples[hover];
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x(s), y(s[key]), 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  return hover;
}
