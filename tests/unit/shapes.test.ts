import { describe, expect, it } from 'vitest';
import { CURVE_FOR, JUST_RATIOS, curvePoints, symmetryFor } from '../../src/visuals/shapes';

describe('geometry curves', () => {
  it('each timbre has its own curve family', () => {
    expect(new Set(Object.values(CURVE_FOR)).size).toBe(4);
    expect(CURVE_FOR.sine).toBe('lissajous');
  });

  it('symmetry comes from the pitch class, so octaves share a shape', () => {
    expect(symmetryFor(60)).toBe(symmetryFor(72)); // C4 and C5
    expect(symmetryFor(60)).not.toBe(symmetryFor(67)); // C and G differ
    for (let m = 48; m < 60; m++) {
      expect(symmetryFor(m)).toBeGreaterThanOrEqual(3);
      expect(symmetryFor(m)).toBeLessThanOrEqual(11);
    }
  });

  it('a perfect fifth (G above C) uses the 3:2 ratio', () => {
    expect(JUST_RATIOS[7]).toEqual([3, 2]);
  });

  it('curves are unit-sized and closed', () => {
    for (const kind of ['rose', 'spirograph', 'lissajous', 'flower'] as const) {
      for (const midi of [48, 55, 61, 70]) {
        const pts = curvePoints(kind, midi, 480);
        let max = 0;
        for (let i = 0; i < 480; i++) max = Math.max(max, Math.hypot(pts[i * 2], pts[i * 2 + 1]));
        expect(max).toBeCloseTo(1, 5);
        const gap = Math.hypot(pts[0] - pts[958], pts[1] - pts[959]);
        expect(gap, `${kind} ${midi}`).toBeLessThan(0.02);
      }
    }
  });
});
