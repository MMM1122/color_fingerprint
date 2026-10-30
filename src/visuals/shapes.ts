/**
 * Two more visual styles, as pure CPU pools (no WebGL) so they share the luminance model and the
 * flash limiter with everything else.
 *
 *  - Water drops: each note lands like a drop at its height and sends out a few expanding rings.
 *  - Geometry: each note draws a mathematical curve that is traced like a spirograph pen, then turns
 *    slowly and fades. The curve family comes from the closest timbre, the symmetry from the note.
 */
import type { Timbre } from '../types';

/* ------------------------------------------------------------------ */
/* Water drops                                                         */
/* ------------------------------------------------------------------ */

export const RIPPLES = {
  capacity: 160,
  maxDropsPerSec: 3,
  idleDropEvery: 0.8,
  ringsPerDrop: [2, 4] as [number, number],
  ringGap: 0.22, // seconds between rings of one drop
  speed: [0.22, 0.36] as [number, number], // radius growth, units per second
  life: [2.2, 3.0] as [number, number],
  thickness: [0.008, 0.016] as [number, number],
  fadeIn: 0.12,
};

export class Ripples {
  readonly n = RIPPLES.capacity;
  readonly x = new Float32Array(this.n);
  readonly y = new Float32Array(this.n);
  readonly r = new Float32Array(this.n);
  readonly speed = new Float32Array(this.n);
  readonly thick = new Float32Array(this.n);
  readonly age = new Float32Array(this.n); // negative = waiting to start
  readonly life = new Float32Array(this.n);
  readonly rgb = new Float32Array(this.n * 3);
  readonly alpha = new Float32Array(this.n);
  readonly lum = new Float32Array(this.n);
  readonly red = new Float32Array(this.n);
  readonly active = new Uint8Array(this.n);
  private cursor = 0;

  take(): number {
    for (let k = 0; k < this.n; k++) {
      const i = (this.cursor + k) % this.n;
      if (!this.active[i]) {
        this.cursor = (i + 1) % this.n;
        return i;
      }
    }
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    return i;
  }
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

export const PATTERNS = {
  capacity: 7,
  pointsPerPattern: 480,
  maxPerSec: 2,
  idleEvery: 1.2,
  drawSeconds: 0.8, // time for the "pen" to trace the whole curve
  life: [3.2, 4.2] as [number, number],
  size: [0.24, 0.42] as [number, number], // radius in scene units
  spin: [0.12, 0.28] as [number, number], // radians per second
  dot: 0.0075,
  fadeIn: 0.1,
};

export type CurveKind = 'rose' | 'spirograph' | 'lissajous' | 'flower';

/** Which curve each timbre draws. A pure tone draws the purest figure: a Lissajous curve. */
export const CURVE_FOR: Record<Timbre, CurveKind> = {
  piano: 'rose',
  strings: 'spirograph',
  sine: 'lissajous',
  voice: 'flower',
};

/**
 * Just-intonation frequency ratios of each pitch class above C. A Lissajous figure drawn with the
 * ratio p:q is simple for consonant intervals (fifth 3:2, fourth 4:3) and dense for dissonant ones.
 */
export const JUST_RATIOS: [number, number][] = [
  [1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [7, 5], [3, 2], [8, 5], [5, 3], [7, 4], [15, 8],
];

/** Symmetry (number of petals, points or lobes) from the note's pitch class: C = 3 … G# = 11, A = 3 … */
export function symmetryFor(midi: number): number {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return 3 + (pc % 9);
}

/** Unit-sized curve (max radius ≈ 1) as interleaved x, y. */
export function curvePoints(kind: CurveKind, midi: number, count: number): Float32Array {
  const out = new Float32Array(count * 2);
  const n = symmetryFor(midi);
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * Math.PI * 2;
    let x = 0;
    let y = 0;
    if (kind === 'rose') {
      // r = cos(kθ): k odd → k petals, k even → 2k petals.
      const r = Math.cos(n * t);
      x = r * Math.cos(t);
      y = r * Math.sin(t);
    } else if (kind === 'spirograph') {
      // Hypotrochoid with R = n, r = 1 → n − 1 loops/cusps around the center.
      const R = n;
      const d = 1.6;
      x = (R - 1) * Math.cos(t) + d * Math.cos((R - 1) * t);
      y = (R - 1) * Math.sin(t) - d * Math.sin((R - 1) * t);
    } else if (kind === 'lissajous') {
      const [p, q] = JUST_RATIOS[pc];
      x = Math.sin(p * t + Math.PI / (2 * q));
      y = Math.sin(q * t);
    } else {
      // Epitrochoid "flower": n lobes with small loops.
      const R = n;
      const d = 0.7;
      x = (R + 1) * Math.cos(t) - d * Math.cos((R + 1) * t);
      y = (R + 1) * Math.sin(t) - d * Math.sin((R + 1) * t);
    }
    out[i * 2] = x;
    out[i * 2 + 1] = y;
    max = Math.max(max, Math.hypot(x, y));
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export type Pattern = {
  active: boolean;
  kind: CurveKind;
  unit: Float32Array; // unit-size curve
  cx: number; cy: number; size: number;
  angle: number; spin: number;
  age: number; life: number;
  rgb: [number, number, number];
  lum: number; red: number;
};

export class Patterns {
  readonly list: Pattern[] = Array.from({ length: PATTERNS.capacity }, () => ({
    active: false, kind: 'rose', unit: new Float32Array(0), cx: 0, cy: 0, size: 0,
    angle: 0, spin: 0, age: 0, life: 1, rgb: [0, 0, 0], lum: 0, red: 0,
  }));
  /** Flattened dots for rendering: x, y, alpha per dot, plus color per dot. */
  readonly dots = new Float32Array(PATTERNS.capacity * PATTERNS.pointsPerPattern * 3);
  readonly dotRgb = new Float32Array(PATTERNS.capacity * PATTERNS.pointsPerPattern * 3);
  dotCount = 0;

  take(): Pattern {
    const free = this.list.find((p) => !p.active);
    if (free) return free;
    return this.list.reduce((oldest, p) => (p.age / p.life > oldest.age / oldest.life ? p : oldest));
  }
}
