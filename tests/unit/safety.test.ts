import { describe, expect, it } from 'vitest';
import { FlashLimiter, defaultLimiterOptions, maxFlashesPerSecond } from '../../src/visuals/safety';
import { ParticleField } from '../../src/visuals/particles';
import { FeatureExtractor } from '../../src/audio/features';
import { mulberry32 } from '../../src/science/trials';

const FPS = 60;

describe('flash counter (WCAG definition)', () => {
  it('counts a 10 Hz full-swing square wave as 10 flashes per second', () => {
    const s = Array.from({ length: FPS * 2 }, (_, i) => (Math.floor(i / 3) % 2 ? 0.6 : 0));
    expect(maxFlashesPerSecond(s, FPS)).toBeGreaterThanOrEqual(9);
  });
  it('ignores small changes', () => {
    const s = Array.from({ length: FPS * 2 }, (_, i) => (Math.floor(i / 3) % 2 ? 0.05 : 0));
    expect(maxFlashesPerSecond(s, FPS)).toBe(0);
  });
});

describe('flash limiter', () => {
  for (const reduced of [false, true]) {
    it(`keeps an adversarial 10 Hz on/off input at ≤ 3 flashes/s (reduced motion: ${reduced})`, () => {
      const lim = new FlashLimiter(defaultLimiterOptions(reduced));
      const out: number[] = [];
      for (let i = 0; i < FPS * 5; i++) out.push(lim.step(Math.floor(i / 3) % 2 ? 0.6 : 0, 1 / FPS, i / FPS));
      expect(maxFlashesPerSecond(out, FPS)).toBeLessThanOrEqual(3);
    });
  }

  it('enforces the 3-flash budget even with a fast slew rate', () => {
    const lim = new FlashLimiter({ maxSlewPerSec: 100, maxFlashesPerSec: 3, delta: 0.1, darkerBelow: 0.8 });
    const out: number[] = [];
    // Slow enough that each half-cycle reaches full height: 8 Hz square wave.
    for (let i = 0; i < FPS * 5; i++) out.push(lim.step(Math.floor((i * 16) / FPS) % 2 ? 0.5 : 0, 1 / FPS, i / FPS));
    expect(maxFlashesPerSecond(out, FPS)).toBeLessThanOrEqual(3);
  });
});

describe('safety test from spec section 8', () => {
  it('a synthetic track of loud clicks at 10/s produces ≤ 3 flashes per second', () => {
    const SR = 44100;
    const seconds = 6;
    const audio = new Float32Array(SR * seconds);
    for (let k = 0; k < seconds * 10; k++) {
      const start = Math.round((k / 10) * SR);
      for (let i = 0; i < 400; i++) audio[start + i] = 0.95 * (i % 2 ? 1 : -1) * Math.exp(-i / 80);
    }
    for (const reducedMotion of [false, true]) {
      const fx = new FeatureExtractor(SR);
      const field = new ParticleField({ reducedMotion, intensity: 1, aspect: 16 / 9 }, mulberry32(3));
      const shown: number[] = [];
      const hop = SR / FPS;
      for (let f = 0; f * hop + 2048 < audio.length; f++) {
        const start = Math.round(f * hop);
        const feat = fx.analyze(audio.subarray(start, start + 2048), (f / FPS) * 1000);
        // Worst case for brightness: a very light, saturated red color on every frame with sound.
        field.update(
          { color: [0.68, 0.24, 28], midi: 70, rms: feat.rms, onset: feat.onset, flatness: feat.flatness, silent: feat.silent },
          1 / FPS,
          f / FPS,
        );
        shown.push(field.shownLuminance);
      }
      expect(maxFlashesPerSecond(shown, FPS)).toBeLessThanOrEqual(3);
    }
  });
});
