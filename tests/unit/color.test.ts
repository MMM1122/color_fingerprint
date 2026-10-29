import { describe, expect, it } from 'vitest';
import { converter, parse } from 'culori';
import { answerFromOklch, deltaELuv, hexToLuv, hexToOklch, hueDelta, meanOklch } from '../../src/science/color';

describe('color conversions', () => {
  it('hex → OKLCH matches culori reference output', () => {
    const toOklch = converter('oklch');
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#336699', '#f0e68c']) {
      const ref = toOklch(parse(hex)!);
      const [l, c, h] = hexToOklch(hex);
      expect(l).toBeCloseTo(ref.l, 3);
      expect(c).toBeCloseTo(ref.c, 3);
      expect(h).toBeCloseTo(ref.h ?? 0, 1);
    }
  });

  it('hex → CIELUV (D65) matches published reference values', () => {
    // Bruce Lindbloom's calculator, sRGB, D65 reference white.
    const cases: [string, [number, number, number]][] = [
      ['#ff0000', [53.2408, 175.0151, 37.7564]],
      ['#00ff00', [87.7347, -83.0776, 107.3986]],
      ['#0000ff', [32.297, -9.4054, -130.3423]],
      ['#ffffff', [100, 0, 0]],
      ['#000000', [0, 0, 0]],
    ];
    for (const [hex, ref] of cases) {
      const v = hexToLuv(hex);
      for (let i = 0; i < 3; i++) expect(Math.abs(v[i] - ref[i])).toBeLessThan(0.05);
    }
  });

  it('CIELUV agrees with culori D65 L* (lab65 L equals luv L)', () => {
    const lab65 = converter('lab65');
    for (const hex of ['#336699', '#abcdef', '#7f7f7f']) {
      expect(hexToLuv(hex)[0]).toBeCloseTo(lab65(parse(hex)!).l, 2);
    }
  });

  it('answers store hex, LUV and OKLCH that agree', () => {
    const a = answerFromOklch([0.7, 0.4, 140]); // out of gamut → clamped
    expect(a.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.luv).toEqual(hexToLuv(a.hex));
    expect(a.oklch).toEqual(hexToOklch(a.hex));
  });

  it('ΔE of identical colors is 0 and is symmetric', () => {
    expect(deltaELuv([50, 1, 2], [50, 1, 2])).toBe(0);
    expect(deltaELuv([50, 0, 0], [53, 4, 0])).toBe(5);
  });

  it('hue difference takes the short way', () => {
    expect(hueDelta(350, 10)).toBe(20);
    expect(hueDelta(10, 350)).toBe(-20);
  });

  it('mean color averages hue across 0°', () => {
    const m = meanOklch([
      [0.6, 0.1, 350],
      [0.6, 0.1, 10],
    ])!;
    expect(Math.min(m[2], 360 - m[2])).toBeLessThan(0.01);
  });
});
