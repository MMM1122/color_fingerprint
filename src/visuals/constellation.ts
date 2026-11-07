/**
 * Constellation style: each note becomes a star at its pitch height, in the person's color, and a thin
 * line joins it to the star before, so a melody draws its own outline from left to right. After a
 * pause, or at the right edge, a new constellation starts. Faint gray "dust" stars sit behind.
 *
 * A pure CPU pool, like the other styles, so it shares the luminance model and the flash limiter.
 * Stereo: with left/right on, a star shifts a little toward its side within its own column (left and
 * right already mean time here, so it can't jump across the screen).
 */

export const CONSTELLATION = {
  capacity: 160,
  maxPerSec: 4,
  /** A star even without a clear onset, while sound continues. */
  idleEvery: 0.9,
  /** Stars across the screen before wrapping back to the left. */
  columns: 22,
  /** Star radius in scene units (the screen is 2 units tall). */
  size: [0.011, 0.026] as [number, number],
  life: [9, 12] as [number, number],
  fadeIn: 0.2,
  /** Extra brightness at birth (a gentle twinkle), decaying over `twinkleFor` seconds. */
  twinkle: 0.4,
  twinkleFor: 0.7,
  lineWidth: 0.0032,
  lineAlpha: 0.38,
  /** Time for a new line to draw itself from the previous star. */
  drawSeconds: 0.4,
  /** Seconds of quiet after which the next star starts a new constellation. */
  breakAfter: 2.5,
  /** How far a star can lean toward its stereo side, as a fraction of a column. */
  panLean: 0.8,
  dust: 70,
  dustSize: 0.0045,
  dustAlpha: [0.05, 0.13] as [number, number],
};

export type Star = {
  active: boolean;
  x: number; y: number; size: number;
  rgb: [number, number, number]; lum: number; red: number;
  age: number; life: number; alpha: number;
  /** Line from the previous star, if this star continues a constellation. */
  link: null | { x: number; y: number; rgb: [number, number, number]; ageOffset: number; life: number; lum: number; red: number };
};

export class Constellation {
  readonly stars: Star[] = Array.from({ length: CONSTELLATION.capacity }, () => ({
    active: false, x: 0, y: 0, size: 0, rgb: [0, 0, 0], lum: 0, red: 0, age: 0, life: 1, alpha: 0, link: null,
  }));
  /** Background dust: x, y, phase, base alpha. */
  readonly dust: Float32Array;
  column = -1;
  last: Star | null = null;
  lastAt = -Infinity;

  constructor(rng: () => number) {
    const D = CONSTELLATION;
    this.dust = new Float32Array(D.dust * 4);
    for (let i = 0; i < D.dust; i++) {
      this.dust[i * 4] = rng() * 2 - 1; // x as a fraction of the half-width
      this.dust[i * 4 + 1] = rng() * 2 - 1;
      this.dust[i * 4 + 2] = rng() * Math.PI * 2;
      this.dust[i * 4 + 3] = D.dustAlpha[0] + (D.dustAlpha[1] - D.dustAlpha[0]) * rng();
    }
  }

  take(): Star {
    const free = this.stars.find((s) => !s.active);
    if (free) return free;
    return this.stars.reduce((oldest, s) => (s.age / s.life > oldest.age / oldest.life ? s : oldest));
  }

  /** Render buffers, filled by ParticleField.update. Stars: x, y, alpha, size (+ rgb). */
  readonly starBuf = new Float32Array((CONSTELLATION.capacity + CONSTELLATION.dust) * 4);
  readonly starRgb = new Float32Array((CONSTELLATION.capacity + CONSTELLATION.dust) * 3);
  starCount = 0;
  /** Lines: x1, y1, x2, y2, and an rgba color at each end. */
  readonly lineBuf = new Float32Array(CONSTELLATION.capacity * 4);
  readonly lineA = new Float32Array(CONSTELLATION.capacity * 4);
  readonly lineB = new Float32Array(CONSTELLATION.capacity * 4);
  lineCount = 0;

  /** Column for the next star (advances the cursor), and whether it joins the previous star. */
  nextColumn(now: number): { col: number; continues: boolean } {
    const D = CONSTELLATION;
    let continues = this.last !== null && this.last.active && now - this.lastAt < D.breakAfter;
    this.column++;
    if (this.column >= D.columns) {
      this.column = 0;
      continues = false;
    }
    if (!continues && this.lastAt > -Infinity && now - this.lastAt >= D.breakAfter) {
      // After a pause, leave a small gap before the new constellation.
      this.column = Math.min(D.columns - 1, this.column + 1);
    }
    return { col: this.column, continues };
  }

  activeCount(): number {
    return this.stars.reduce((n, s) => n + (s.active ? 1 : 0), 0);
  }
}

/** Alpha of a star at a given age: quick fade-in, twinkle, long fade-out over the last 40%. */
export function starAlpha(age: number, life: number): number {
  const D = CONSTELLATION;
  if (age < 0 || age >= life) return 0;
  const fin = Math.min(1, age / D.fadeIn);
  const fout = Math.min(1, (life - age) / (life * 0.4));
  const tw = 1 + D.twinkle * Math.max(0, 1 - age / D.twinkleFor);
  return fin * fout * tw;
}
