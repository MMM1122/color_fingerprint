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

describe('palette colors (representative color)', () => {
  it('blue and yellow answers do not average to gray: the middle answer is used', async () => {
    const { representativeColor, meanOklch } = await import('../../src/science/color');
    const blue: [number, number, number] = [0.55, 0.18, 260];
    const yellow: [number, number, number] = [0.9, 0.17, 100];
    const blue2: [number, number, number] = [0.58, 0.16, 255];
    expect(meanOklch([blue, yellow, blue2])![1]).toBeLessThan(0.07); // the old, muddy result
    const r = representativeColor([blue, yellow, blue2])!;
    expect(r[1]).toBeGreaterThan(0.15);
    expect(Math.abs(r[2] - 257)).toBeLessThan(5); // one of the blues
  });

  it('similar answers keep their colorfulness instead of washing out', async () => {
    const { representativeColor, meanOklch } = await import('../../src/science/color');
    const cols: [number, number, number][] = [
      [0.6, 0.2, 20],
      [0.62, 0.2, 60],
      [0.58, 0.2, 40],
    ];
    const r = representativeColor(cols)!;
    expect(r[1]).toBeCloseTo(0.2, 5);
    expect(r[2]).toBeCloseTo(40, 1);
    expect(meanOklch(cols)![1]).toBeLessThan(0.2);
  });

  it('a gray answer barely moves the hue', async () => {
    const { representativeColor } = await import('../../src/science/color');
    const r = representativeColor([
      [0.6, 0.2, 140],
      [0.6, 0.01, 300],
    ])!;
    expect(Math.abs(r[2] - 140)).toBeLessThan(5);
  });

  it('live blending picks the dominant timbre when hues clash', async () => {
    const { representativeColor } = await import('../../src/science/color');
    const r = representativeColor(
      [
        [0.6, 0.2, 30],
        [0.6, 0.2, 200],
      ],
      [0.4, 0.6],
    )!;
    expect(r[2]).toBe(200);
  });
});

describe('picker gamut helpers', () => {
  it('fast conversion and max chroma agree with culori', async () => {
    const { maxChroma, inSrgbGamut, encodeSrgb8, oklchToLinearSrgb, oklchToHex } = await import('../../src/science/color');
    const { displayable } = await import('culori');
    for (const [l, h] of [[0.5, 30], [0.7, 140], [0.45, 265], [0.9, 105], [0.3, 320]]) {
      const m = maxChroma(l, h);
      expect(displayable({ mode: 'oklch', l, c: m * 0.99, h })).toBe(true);
      expect(displayable({ mode: 'oklch', l, c: m * 1.02 + 0.002, h })).toBe(false);
      expect(inSrgbGamut(l, m * 1.05 + 0.002, h)).toBe(false);
    }
    // Pixel colors match culori's hex for an in-gamut color.
    const rgb = oklchToLinearSrgb(0.6, 0.1, 200).map(encodeSrgb8);
    const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    const ref = oklchToHex([0.6, 0.1, 200]);
    const diff = [1, 3, 5].map((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(ref.slice(i, i + 2), 16)));
    expect(Math.max(...diff)).toBeLessThanOrEqual(1);
  });
});
