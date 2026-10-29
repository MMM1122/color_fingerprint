/**
 * Photosensitivity safety (WCAG 2.3.1, "Three Flashes or Below Threshold").
 *
 * A flash is a pair of opposing changes in relative luminance of ≥ 0.10 where the darker state is
 * below 0.80. The limiter sits between the particle simulation and the renderer:
 *
 *  - Upward luminance changes are slew-limited (max change per second).
 *  - Every completed ≥0.10 transition is time-stamped; if 6 transitions (3 flashes) already
 *    happened in the last second, the next upward swing is clamped just below 0.10.
 *  - The limiter can only DIM the scene (gain ≤ 1). Downward changes are kept slow by design:
 *    particles fade out over ≥ 1 s and no single particle covers enough of the screen to matter.
 *
 * The same limiter runs on a second channel that measures saturated red, so red cannot flash either.
 */
import { SAFETY } from '../config/stimuli';

export type LimiterOptions = {
  maxSlewPerSec: number;
  maxFlashesPerSec: number;
  delta: number;
  darkerBelow: number;
};

export const defaultLimiterOptions = (reducedMotion: boolean): LimiterOptions => ({
  maxSlewPerSec: reducedMotion ? SAFETY.maxLuminanceSlewPerSecReduced : SAFETY.maxLuminanceSlewPerSec,
  maxFlashesPerSec: SAFETY.maxFlashesPerSecond,
  delta: SAFETY.flashLuminanceDelta,
  darkerBelow: SAFETY.flashDarkerBelow,
});

export class FlashLimiter {
  private lum = 0;
  private swingStart = 0;
  private dir = 0;
  private counted = false;
  private events: number[] = [];

  constructor(private o: LimiterOptions) {}

  get current() {
    return this.lum;
  }

  /** Feed the luminance the scene WOULD show; get back the luminance it is allowed to show (≤ raw). */
  step(raw: number, dtSec: number, nowSec: number): number {
    const target = Math.max(0, raw);
    let next = target > this.lum ? Math.min(target, this.lum + this.o.maxSlewPerSec * dtSec) : target;

    // Track swings between turning points.
    const move = next - this.lum;
    const newDir = Math.abs(move) < 1e-6 ? this.dir : Math.sign(move);
    if (newDir !== this.dir && this.dir !== 0) {
      this.swingStart = this.lum;
      this.counted = false;
    }
    this.dir = newDir;

    this.events = this.events.filter((t) => nowSec - t < 1);
    const swing = next - this.swingStart;
    const darker = Math.min(next, this.swingStart);
    if (!this.counted && Math.abs(swing) >= this.o.delta && darker < this.o.darkerBelow) {
      if (swing > 0 && this.events.length >= this.o.maxFlashesPerSec * 2) {
        // Budget spent: keep this upward swing just under the flash threshold.
        next = this.swingStart + this.o.delta * 0.95;
      } else {
        this.events.push(nowSec);
        this.counted = true;
      }
    }
    this.lum = next;
    return next;
  }
}

/**
 * Independent WCAG flash counter over a sampled luminance series. Returns the maximum number of
 * flashes (pairs of opposing ≥ delta transitions) in any 1-second window. Used by tests and the
 * debug overlay; deliberately does not share code with the limiter.
 */
export function maxFlashesPerSecond(series: number[], fps: number, delta = SAFETY.flashLuminanceDelta, darkerBelow = SAFETY.flashDarkerBelow): number {
  // Find turning points, then transitions between successive extrema that are ≥ delta.
  const extrema: { i: number; v: number }[] = [];
  let dir = 0;
  for (let i = 1; i < series.length; i++) {
    const d = Math.sign(series[i] - series[i - 1]);
    if (d === 0) continue;
    if (dir !== 0 && d !== dir) extrema.push({ i: i - 1, v: series[i - 1] });
    if (extrema.length === 0 && dir === 0) extrema.push({ i: 0, v: series[0] });
    dir = d;
  }
  extrema.push({ i: series.length - 1, v: series[series.length - 1] });
  const transitions: number[] = [];
  let anchor = extrema[0];
  for (let k = 1; k < extrema.length; k++) {
    const e = extrema[k];
    if (Math.abs(e.v - anchor.v) >= delta && Math.min(e.v, anchor.v) < darkerBelow) {
      transitions.push(e.i / fps);
      anchor = e;
    }
  }
  let worst = 0;
  for (let a = 0; a < transitions.length; a++) {
    let b = a;
    while (b + 1 < transitions.length && transitions[b + 1] - transitions[a] < 1) b++;
    worst = Math.max(worst, Math.floor((b - a + 1) / 2));
  }
  return worst;
}
