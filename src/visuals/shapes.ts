/**
 * Water drops, as a pure CPU pool (no WebGL) so it shares the luminance model and the flash limiter
 * with everything else: each note lands like a drop at its height and sends out a few expanding rings.
 * (The constellation style lives in constellation.ts.)
 */

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
