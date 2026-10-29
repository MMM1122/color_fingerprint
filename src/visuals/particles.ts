/**
 * CPU particle simulation for the associator view. Pure (no WebGL), so its luminance behaviour,
 * and therefore the flash limiter, can be tested headlessly.
 *
 * Sound → visual mapping (spec section 4):
 *  - pitch + timbre → color (from the personal map)   - pitch height → vertical position, drift direction
 *  - loudness → size, glow (capped)                    - onsets → new shapes (rate-capped)
 *  - noisiness → grain                                 - silence → shapes fade, background holds
 */
import { MAP_MIDI_MAX, MAP_MIDI_MIN, SAFETY } from '../config/stimuli';
import type { Oklch } from '../types';
import { hueDelta, oklchToRgb01, relativeLuminance } from '../science/color';
import { FlashLimiter, defaultLimiterOptions } from './safety';

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
};

export type FieldOptions = { reducedMotion: boolean; intensity: number; aspect: number };

const CAPACITY = 320;
/** Visual bloom roughly adds this fraction of light on top of the particles. */
export const BLOOM_GAIN = 0.6;

function redness([, c, h]: Oklch): number {
  const near = 1 - Math.min(1, Math.abs(hueDelta(h, 25)) / 35);
  return Math.max(0, near) * Math.min(1, Math.max(0, (c - 0.08) / 0.12));
}

export class ParticleField {
  readonly particles: Particle[] = Array.from({ length: CAPACITY }, () => ({
    active: false, x: 0, y: 0, vx: 0, vy: 0, size: 0, rgb: [0, 0, 0], lum: 0, red: 0,
    age: 0, life: 1, fadeIn: 0.3, peak: 0, grain: 0, alpha: 0,
  }));
  private lumLimiter: FlashLimiter;
  private redLimiter: FlashLimiter;
  private spawnCredit = 0;
  private recentSpawns: number[] = [];
  private loud = 0;
  /** Global gain applied to every particle this frame (≤ 1), set by the limiters. */
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

  setReducedMotion(r: boolean) {
    this.opts.reducedMotion = r;
    this.lumLimiter = new FlashLimiter(defaultLimiterOptions(r));
    this.redLimiter = new FlashLimiter(defaultLimiterOptions(r));
  }

  private spawn(color: Oklch, midi: number, loud: number, grain: number) {
    const p = this.particles.find((q) => !q.active);
    if (!p) return;
    const r = this.opts.reducedMotion;
    const t = Math.min(1, Math.max(0, (midi - MAP_MIDI_MIN) / (MAP_MIDI_MAX - MAP_MIDI_MIN)));
    const a = this.opts.aspect;
    p.active = true;
    p.x = (this.rng() * 2 - 1) * a * 0.85;
    p.y = -0.8 + t * 1.6 + (this.rng() - 0.5) * 0.15;
    const speed = (r ? 0.012 : 0.035) * (0.6 + this.rng() * 0.8);
    p.vy = (t - 0.45) * 2 * speed; // high notes drift up, low notes drift down
    p.vx = (this.rng() - 0.5) * speed;
    p.size = Math.min(0.5, (0.16 + loud * 0.3) * (0.8 + this.rng() * 0.4)) * (0.6 + 0.4 * this.opts.intensity);
    p.rgb = oklchToRgb01(color);
    p.lum = relativeLuminance(p.rgb);
    p.red = redness(color);
    p.age = 0;
    p.life = (r ? 6 : 4) + this.rng() * 3;
    p.fadeIn = r ? 0.9 : 0.35;
    p.peak = 0.55 * (0.5 + 0.5 * this.opts.intensity);
    p.grain = Math.min(1, grain * 4);
    p.alpha = 0;
  }

  update(input: FieldInput, dt: number, now: number): void {
    const r = this.opts.reducedMotion;
    const loudTarget = input.silent ? 0 : Math.min(1, input.rms / 0.25);
    this.loud += (loudTarget - this.loud) * (1 - Math.exp(-dt / 0.25));

    // Spawning: steady stream while sound is present, plus onsets. Capped per second.
    const maxPerSec = r ? 3 : 8;
    this.recentSpawns = this.recentSpawns.filter((t) => now - t < 1);
    if (input.color && input.midi != null && !input.silent) {
      this.spawnCredit += dt * (r ? 1.2 : 2 + 4 * this.loud);
      if (input.onset && !r) this.spawnCredit += 1.5;
      while (this.spawnCredit >= 1 && this.recentSpawns.length < maxPerSec) {
        this.spawn(input.color, input.midi, this.loud, input.flatness);
        this.recentSpawns.push(now);
        this.spawnCredit -= 1;
      }
      this.spawnCredit = Math.min(this.spawnCredit, 3);
      // Background: a very dark, low-chroma echo of the current color, changing over seconds.
      const k = 1 - Math.exp(-dt / 2.5);
      const target: Oklch = [0.1 + 0.04 * input.color[0], Math.min(0.02, input.color[1] * 0.2), input.color[2]];
      this.bgLab = [
        this.bgLab[0] + (target[0] - this.bgLab[0]) * k,
        this.bgLab[1] + (target[1] - this.bgLab[1]) * k,
        this.bgLab[2] + hueDelta(this.bgLab[2], target[2]) * k,
      ];
    }
    this.background = oklchToRgb01(this.bgLab);

    // Age and fade. Fade-out spans the last 40% of life (≥ 1.6 s), so luminance only falls slowly.
    const area = 4 * this.opts.aspect;
    let lum = relativeLuminance(this.background);
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
    lum = Math.min(lum, 1);
    this.rawLuminance = lum;

    const shownLum = this.lumLimiter.step(Math.min(lum, SAFETY.maxSceneLuminance), dt, now);
    const shownRed = this.redLimiter.step(red, dt, now);
    const gLum = lum > 1e-5 ? shownLum / lum : 1;
    const gRed = red > 1e-5 ? shownRed / red : 1;
    this.exposure = Math.max(0, Math.min(1, gLum, gRed));
    this.shownLuminance = relativeLuminance(this.background) + (lum - relativeLuminance(this.background)) * this.exposure;
  }
}
