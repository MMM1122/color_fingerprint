/**
 * CPU particle simulation. Pure (no WebGL), so its luminance behaviour, and therefore the flash
 * limiter, can be tested headlessly.
 *
 * Two styles:
 *  - 'fireworks' (default): each note onset bursts into sharp sparks at the note's height. Sparks fly
 *    outward, slow down, fall under gravity and fade, leaving short streaks. A few faint glows sit
 *    behind them.
 *  - 'glow': the soft, drifting "mind's eye" field. Always used with reduced motion (spec: blur
 *    instead of bursts).
 *
 * Sound → visual mapping (spec section 4):
 *  - pitch + timbre → color (from the personal map)   - pitch height → vertical position, drift
 *  - loudness → size, spark count, glow (capped)       - onsets → new shapes (rate-capped)
 *  - noisiness → grain                                 - silence → shapes fade, background holds
 *
 * Safety: every shape's light passes through the flash limiter (exposure). Bursts are capped per
 * second, each burst covers only a small part of the screen, and sparks fade out over ≥ 0.9 s.
 */
import { MAP_MIDI_MAX, MAP_MIDI_MIN, SAFETY } from '../config/stimuli';
import type { Oklch } from '../types';
import { hueDelta, oklchToRgb01, relativeLuminance } from '../science/color';
import { FlashLimiter, defaultLimiterOptions } from './safety';
import { CURVE_FOR, PATTERNS, Patterns, RIPPLES, Ripples, curvePoints } from './shapes';
import type { Timbre } from '../types';

export type VisualStyle = 'fireworks' | 'ripples' | 'geometry' | 'glow';
export const VISUAL_STYLES: { id: VisualStyle; label: string }[] = [
  { id: 'fireworks', label: 'Fireworks' },
  { id: 'ripples', label: 'Water drops' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'glow', label: 'Soft glow' },
];

export type Particle = {
  active: boolean;
  x: number; y: number; vx: number; vy: number;
  size: number;
  rgb: [number, number, number]; // sRGB 0-1
  lum: number; // relative luminance of rgb
  red: number; // 0-1, how saturated-red the color is
  age: number; life: number; fadeIn: number;
  peak: number; grain: number;
  alpha: number;
};

export type FieldInput = {
  color: Oklch | null;
  midi: number | null;
  rms: number;
  onset: boolean;
  flatness: number;
  silent: boolean;
  /** Closest timbre right now (picks the geometry curve). */
  timbre?: Timbre;
};

export type FieldOptions = { reducedMotion: boolean; intensity: number; aspect: number; style?: VisualStyle };

const CAPACITY = 320;
export const SPARK_CAPACITY = 1600;
/** Visual bloom roughly adds this fraction of light on top of the shapes. */
export const BLOOM_GAIN = 0.6;

export const FIREWORKS = {
  maxBurstsPerSec: 4,
  /** When sound is sustained with no onsets, still burst this often (seconds). */
  idleBurstEvery: 0.7,
  minSparks: 36,
  maxSparks: 90,
  speed: [0.55, 1.25] as [number, number],
  drag: 1.5, // per second
  gravity: 0.3, // units per second²
  life: [1.0, 1.9] as [number, number],
  size: [0.016, 0.028] as [number, number],
  /** Hot white core at the start of each spark's life (seconds). */
  hotFor: 0.12,
  fadeIn: 0.05,
};

function redness([, c, h]: Oklch): number {
  const near = 1 - Math.min(1, Math.abs(hueDelta(h, 25)) / 35);
  return Math.max(0, near) * Math.min(1, Math.max(0, (c - 0.08) / 0.12));
}

/** Spark pool as flat arrays (fast to update and to upload to the GPU). */
export class Sparks {
  readonly n = SPARK_CAPACITY;
  readonly x = new Float32Array(this.n);
  readonly y = new Float32Array(this.n);
  readonly vx = new Float32Array(this.n);
  readonly vy = new Float32Array(this.n);
  readonly size = new Float32Array(this.n);
  readonly age = new Float32Array(this.n);
  readonly life = new Float32Array(this.n);
  /** Base color (sRGB 0-1) and the color shown this frame. */
  readonly base = new Float32Array(this.n * 3);
  readonly rgb = new Float32Array(this.n * 3);
  readonly alpha = new Float32Array(this.n);
  readonly lum = new Float32Array(this.n);
  readonly red = new Float32Array(this.n);
  readonly active = new Uint8Array(this.n);
  private cursor = 0;

  /** Next free slot (or the oldest one if full). */
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

export class ParticleField {
  readonly particles: Particle[] = Array.from({ length: CAPACITY }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, size: 0, rgb: [0, 0, 0], lum: 0, red: 0,
    age: 0, life: 1, fadeIn: 0.3, peak: 0, grain: 0, alpha: 0,
  }));
  readonly sparks = new Sparks();
  readonly ripples = new Ripples();
  readonly patterns = new Patterns();
  private lumLimiter: FlashLimiter;
  private redLimiter: FlashLimiter;
  private spawnCredit = 0;
  private recentSpawns: number[] = [];
  private recentBursts: number[] = [];
  private lastBurst = -Infinity;
  private loud = 0;
  /** Global gain applied to every shape this frame (≤ 1), set by the limiters. */
  exposure = 1;
  /** Luminance the viewer sees (after limiting). */
  shownLuminance = 0;
  rawLuminance = 0;
  background: [number, number, number] = [0.02, 0.02, 0.02];
  private bgLab: Oklch = [0.1, 0, 0];

  constructor(public opts: FieldOptions, private rng: () => number = Math.random) {
    this.lumLimiter = new FlashLimiter(defaultLimiterOptions(opts.reducedMotion));
    this.redLimiter = new FlashLimiter(defaultLimiterOptions(opts.reducedMotion));
  }

  /** Bursty styles only without reduced motion; reduced motion always gets the soft glow. */
  get style(): VisualStyle {
    return this.opts.reducedMotion ? 'glow' : (this.opts.style ?? 'fireworks');
  }

  setReducedMotion(r: boolean) {
    this.opts.reducedMotion = r;
    this.lumLimiter = new FlashLimiter(defaultLimiterOptions(r));
    this.redLimiter = new FlashLimiter(defaultLimiterOptions(r));
  }

  private heightFor(midi: number) {
    return Math.min(1, Math.max(0, (midi - MAP_MIDI_MIN) / (MAP_MIDI_MAX - MAP_MIDI_MIN)));
  }

  private spawnGlow(color: Oklch, midi: number, loud: number, grain: number, faint: boolean) {
    const p = this.particles.find((q) => !q.active);
    if (!p) return;
    const r = this.opts.reducedMotion;
    const t = this.heightFor(midi);
    const a = this.opts.aspect;
    p.active = true;
    p.x = (this.rng() * 2 - 1) * a * 0.85;
    p.y = -0.8 + t * 1.6 + (this.rng() - 0.5) * 0.15;
    const speed = (r ? 0.012 : 0.035) * (0.6 + this.rng() * 0.8);
    p.vy = (t - 0.45) * 2 * speed; // high notes drift up, low notes drift down
    p.vx = (this.rng() - 0.5) * speed;
    p.size = Math.min(0.5, (0.16 + loud * 0.3) * (0.8 + this.rng() * 0.4)) * (0.6 + 0.4 * this.opts.intensity) * (faint ? 1.6 : 1);
    p.rgb = oklchToRgb01(color);
    p.lum = relativeLuminance(p.rgb);
    p.red = redness(color);
    p.age = 0;
    p.life = (r ? 6 : 4) + this.rng() * 3;
    p.fadeIn = r ? 0.9 : 0.35;
    p.peak = 0.55 * (0.5 + 0.5 * this.opts.intensity) * (faint ? 0.1 : 1);
    p.grain = Math.min(1, grain * 4);
    p.alpha = 0;
  }

  /** One firework: sharp sparks flying out from a point at the note's height. */
  private burst(color: Oklch, midi: number, loud: number, now: number) {
    const F = FIREWORKS;
    const sp = this.sparks;
    const t = this.heightFor(midi);
    const a = this.opts.aspect;
    const cx = (this.rng() * 2 - 1) * a * 0.75;
    const cy = -0.7 + t * 1.4;
    const count = Math.round((F.minSparks + (F.maxSparks - F.minSparks) * loud) * (0.5 + 0.5 * this.opts.intensity));
    const speedScale = 0.7 + 0.6 * loud;
    for (let k = 0; k < count; k++) {
      const i = sp.take();
      const ang = (k / count) * Math.PI * 2 + this.rng() * 0.3;
      const v = (F.speed[0] + (F.speed[1] - F.speed[0]) * this.rng()) * speedScale;
      sp.x[i] = cx;
      sp.y[i] = cy;
      sp.vx[i] = Math.cos(ang) * v;
      sp.vy[i] = Math.sin(ang) * v;
      sp.size[i] = F.size[0] + (F.size[1] - F.size[0]) * this.rng();
      sp.age[i] = 0;
      sp.life[i] = F.life[0] + (F.life[1] - F.life[0]) * this.rng();
      // Small per-spark variation so a burst shimmers instead of looking flat.
      const c: Oklch = [
        Math.min(0.97, Math.max(0.2, color[0] + (this.rng() - 0.5) * 0.12)),
        color[1] * (0.85 + this.rng() * 0.3),
        color[2] + (this.rng() - 0.5) * 8,
      ];
      const rgb = oklchToRgb01(c);
      sp.base.set(rgb, i * 3);
      sp.red[i] = redness(c);
      sp.active[i] = 1;
    }
    this.recentBursts.push(now);
    this.lastBurst = now;
  }

  /** One water drop: a few rings that start one after another and spread out. */
  private drop(color: Oklch, midi: number, loud: number, now: number) {
    const R = RIPPLES;
    const rp = this.ripples;
    const t = this.heightFor(midi);
    const a = this.opts.aspect;
    const cx = (this.rng() * 2 - 1) * a * 0.8;
    const cy = -0.75 + t * 1.5;
    const rings = Math.round(R.ringsPerDrop[0] + (R.ringsPerDrop[1] - R.ringsPerDrop[0]) * loud);
    const rgb = oklchToRgb01(color);
    const lumC = relativeLuminance(rgb);
    const redC = redness(color);
    // Higher notes: faster, thinner rings (like small, quick drops).
    const speed = R.speed[0] + (R.speed[1] - R.speed[0]) * (0.4 * this.rng() + 0.6 * t);
    for (let k = 0; k < rings; k++) {
      const i = rp.take();
      rp.x[i] = cx;
      rp.y[i] = cy;
      rp.r[i] = 0;
      rp.speed[i] = speed * (1 - k * 0.08);
      rp.thick[i] = (R.thickness[1] - (R.thickness[1] - R.thickness[0]) * t) * (0.8 + 0.4 * loud);
      rp.age[i] = -k * R.ringGap;
      rp.life[i] = R.life[0] + (R.life[1] - R.life[0]) * this.rng();
      rp.rgb.set(rgb, i * 3);
      rp.lum[i] = lumC;
      rp.red[i] = redC;
      rp.alpha[i] = 0;
      rp.active[i] = 1;
    }
    this.recentBursts.push(now);
    this.lastBurst = now;
  }

  /** One geometric figure at the note's height. */
  private pattern(color: Oklch, midi: number, loud: number, timbre: Timbre, now: number) {
    const P = PATTERNS;
    const p = this.patterns.take();
    const t = this.heightFor(midi);
    const a = this.opts.aspect;
    p.active = true;
    p.kind = CURVE_FOR[timbre];
    p.unit = curvePoints(p.kind, midi, P.pointsPerPattern);
    p.size = (P.size[0] + (P.size[1] - P.size[0]) * loud) * (0.75 + 0.25 * this.opts.intensity);
    p.cx = (this.rng() * 2 - 1) * (a - p.size) * 0.9;
    p.cy = Math.max(-1 + p.size, Math.min(1 - p.size, -0.7 + t * 1.4));
    p.angle = this.rng() * Math.PI * 2;
    p.spin = (P.spin[0] + (P.spin[1] - P.spin[0]) * this.rng()) * (this.rng() < 0.5 ? -1 : 1);
    p.age = 0;
    p.life = P.life[0] + (P.life[1] - P.life[0]) * this.rng();
    p.rgb = oklchToRgb01(color);
    p.lum = relativeLuminance(p.rgb);
    p.red = redness(color);
    this.recentBursts.push(now);
    this.lastBurst = now;
  }

  update(input: FieldInput, dt: number, now: number): void {
    const r = this.opts.reducedMotion;
    const style = this.style;
    const loudTarget = input.silent ? 0 : Math.min(1, input.rms / 0.25);
    this.loud += (loudTarget - this.loud) * (1 - Math.exp(-dt / 0.25));

    // ---- Spawning ----
    const maxPerSec = r ? 3 : style === 'fireworks' ? 2 : 8;
    this.recentSpawns = this.recentSpawns.filter((t) => now - t < 1);
    this.recentBursts = this.recentBursts.filter((t) => now - t < 1);
    if (input.color && input.midi != null && !input.silent) {
      if (style === 'fireworks') {
        const wantBurst = input.onset || (now - this.lastBurst > FIREWORKS.idleBurstEvery && this.loud > 0.08);
        if (wantBurst && this.recentBursts.length < FIREWORKS.maxBurstsPerSec) {
          this.burst(input.color, input.midi, this.loud, now);
        }
        this.spawnCredit += dt * 0.6; // faint background glows
      } else if (style === 'ripples') {
        const want = input.onset || (now - this.lastBurst > RIPPLES.idleDropEvery && this.loud > 0.08);
        if (want && this.recentBursts.length < RIPPLES.maxDropsPerSec) this.drop(input.color, input.midi, this.loud, now);
        this.spawnCredit += dt * 0.4;
      } else if (style === 'geometry') {
        const want = input.onset || (now - this.lastBurst > PATTERNS.idleEvery && this.loud > 0.08);
        if (want && this.recentBursts.length < PATTERNS.maxPerSec) {
          this.pattern(input.color, input.midi, this.loud, input.timbre ?? 'piano', now);
        }
        this.spawnCredit += dt * 0.4;
      } else {
        this.spawnCredit += dt * (r ? 1.2 : 2 + 4 * this.loud);
        if (input.onset && !r) this.spawnCredit += 1.5;
      }
      while (this.spawnCredit >= 1 && this.recentSpawns.length < maxPerSec) {
        this.spawnGlow(input.color, input.midi, this.loud, input.flatness, style !== 'glow');
        this.recentSpawns.push(now);
        this.spawnCredit -= 1;
      }
      this.spawnCredit = Math.min(this.spawnCredit, 3);
      // Background: a very dark, low-chroma echo of the current color, changing over seconds.
      const k = 1 - Math.exp(-dt / 2.5);
      const target: Oklch = [0.1 + 0.04 * input.color[0], Math.min(0.02, input.color[1] * 0.2), input.color[2]];
      if (style !== 'glow') {
        target[0] = 0.055 + 0.02 * input.color[0]; // night sky / dark water
        target[1] = Math.min(0.01, target[1]);
      }
      this.bgLab = [
        this.bgLab[0] + (target[0] - this.bgLab[0]) * k,
        this.bgLab[1] + (target[1] - this.bgLab[1]) * k,
        this.bgLab[2] + hueDelta(this.bgLab[2], target[2]) * k,
      ];
    }
    this.background = oklchToRgb01(this.bgLab);

    // ---- Glows: age and fade. Fade-out spans the last 40% of life (≥ 1.6 s). ----
    const area = 4 * this.opts.aspect;
    const bgLum = relativeLuminance(this.background);
    let lum = bgLum;
    let red = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.alpha = 0;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fin = Math.min(1, p.age / p.fadeIn);
      const fout = Math.min(1, (p.life - p.age) / (p.life * 0.4));
      p.alpha = p.peak * fin * fout;
      // A Gaussian blob of "size" diameter covers about π(size/2)² × 0.5 of full intensity.
      const cover = (Math.PI * (p.size / 2) ** 2 * 0.5) / area;
      lum += p.alpha * p.lum * cover * (1 + BLOOM_GAIN);
      red += p.alpha * p.red * cover * (1 + BLOOM_GAIN);
    }

    // ---- Sparks: drag, gravity, hot white core, fade ----
    const sp = this.sparks;
    const F = FIREWORKS;
    const drag = Math.exp(-F.drag * dt);
    for (let i = 0; i < sp.n; i++) {
      if (!sp.active[i]) continue;
      sp.age[i] += dt;
      const age = sp.age[i];
      const life = sp.life[i];
      if (age >= life) {
        sp.active[i] = 0;
        sp.alpha[i] = 0;
        continue;
      }
      sp.vx[i] *= drag;
      sp.vy[i] = sp.vy[i] * drag - F.gravity * dt;
      sp.x[i] += sp.vx[i] * dt;
      sp.y[i] += sp.vy[i] * dt;
      const hot = Math.max(0, 1 - age / F.hotFor) * 0.45;
      for (let c = 0; c < 3; c++) sp.rgb[i * 3 + c] = sp.base[i * 3 + c] + (1 - sp.base[i * 3 + c]) * hot;
      const fin = Math.min(1, age / F.fadeIn);
      const fout = (1 - age / life) ** 1.4;
      sp.alpha[i] = 1.0 * fin * fout * (0.65 + 0.35 * this.opts.intensity);
      const rr = sp.rgb[i * 3];
      const gg = sp.rgb[i * 3 + 1];
      const bb = sp.rgb[i * 3 + 2];
      sp.lum[i] = relativeLuminance([rr, gg, bb]);
      // Streak: width ≈ 2·size, length grows with speed.
      const speed = Math.hypot(sp.vx[i], sp.vy[i]);
      const cover = (2 * sp.size[i] * (2 * sp.size[i] + speed * STREAK_SECONDS) * 0.6) / area;
      lum += sp.alpha[i] * sp.lum[i] * cover * (1 + BLOOM_GAIN * 1.5);
      red += sp.alpha[i] * sp.red[i] * cover * (1 + BLOOM_GAIN * 1.5);
    }

    // ---- Ripples: rings spread at constant speed and thin out as they grow ----
    const rp = this.ripples;
    for (let i = 0; i < rp.n; i++) {
      if (!rp.active[i]) continue;
      rp.age[i] += dt;
      const age = rp.age[i];
      if (age < 0) {
        rp.alpha[i] = 0;
        continue;
      }
      if (age >= rp.life[i]) {
        rp.active[i] = 0;
        rp.alpha[i] = 0;
        continue;
      }
      rp.r[i] = rp.speed[i] * age;
      const fin = Math.min(1, age / RIPPLES.fadeIn);
      const fout = (1 - age / rp.life[i]) ** 1.5;
      rp.alpha[i] = 0.9 * fin * fout * (0.6 + 0.4 * this.opts.intensity);
      const cover = (2 * Math.PI * Math.max(rp.r[i], rp.thick[i]) * 2 * rp.thick[i] * 0.6) / area;
      lum += rp.alpha[i] * rp.lum[i] * cover * (1 + BLOOM_GAIN);
      red += rp.alpha[i] * rp.red[i] * cover * (1 + BLOOM_GAIN);
    }

    // ---- Patterns: pen traces the curve, then it turns slowly and fades ----
    const pats = this.patterns;
    const P = PATTERNS;
    let d = 0;
    for (const pt of pats.list) {
      if (!pt.active) continue;
      pt.age += dt;
      if (pt.age >= pt.life) {
        pt.active = false;
        continue;
      }
      pt.angle += pt.spin * dt;
      const drawn = Math.min(1, pt.age / P.drawSeconds);
      const fout = Math.min(1, (pt.life - pt.age) / (pt.life * 0.45));
      const fin = Math.min(1, pt.age / P.fadeIn);
      const base = 0.5 * fin * fout * (0.6 + 0.4 * this.opts.intensity);
      const cos = Math.cos(pt.angle);
      const sin = Math.sin(pt.angle);
      const count = pt.unit.length / 2;
      const head = drawn * (count - 1);
      for (let k = 0; k < count; k++) {
        if (k > head) break;
        const ux = pt.unit[k * 2];
        const uy = pt.unit[k * 2 + 1];
        // The pen tip glows a little brighter while it is drawing.
        const tip = drawn < 1 ? Math.max(0, 1 - (head - k) / 18) * 0.6 : 0;
        pats.dots[d * 3] = pt.cx + (ux * cos - uy * sin) * pt.size;
        pats.dots[d * 3 + 1] = pt.cy + (ux * sin + uy * cos) * pt.size;
        pats.dots[d * 3 + 2] = Math.min(1, base * (1 + tip));
        pats.dotRgb[d * 3] = pt.rgb[0] + (1 - pt.rgb[0]) * tip * 0.6;
        pats.dotRgb[d * 3 + 1] = pt.rgb[1] + (1 - pt.rgb[1]) * tip * 0.6;
        pats.dotRgb[d * 3 + 2] = pt.rgb[2] + (1 - pt.rgb[2]) * tip * 0.6;
        const cover = (Math.PI * (2 * P.dot) ** 2 * 0.5) / area;
        lum += pats.dots[d * 3 + 2] * pt.lum * cover * (1 + BLOOM_GAIN);
        red += pats.dots[d * 3 + 2] * pt.red * cover * (1 + BLOOM_GAIN);
        d++;
      }
    }
    pats.dotCount = d;

    lum = Math.min(lum, 1);
    this.rawLuminance = lum;

    const shownLum = this.lumLimiter.step(Math.min(lum, SAFETY.maxSceneLuminance), dt, now);
    const shownRed = this.redLimiter.step(red, dt, now);
    const gLum = lum > 1e-5 ? shownLum / lum : 1;
    const gRed = red > 1e-5 ? shownRed / red : 1;
    this.exposure = Math.max(0, Math.min(1, gLum, gRed));
    this.shownLuminance = bgLum + (lum - bgLum) * this.exposure;
  }
}

/** Streak length in seconds of travel (also used by the renderer). */
export const STREAK_SECONDS = 0.1;
