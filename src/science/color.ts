/** Color conversions and distances, all through culori. */
import { converter, formatHex, clampChroma, parse } from 'culori';
import type { ColorAnswer, Luv, Oklch } from '../types';

const toXyz65 = converter('xyz65');
const toOklch = converter('oklch');
const toRgb = converter('rgb');

const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** Build a full answer (hex, CIELUV, OKLCH) from a picker OKLCH value, clamped into sRGB. */
export function answerFromOklch([l, c, h]: Oklch): ColorAnswer {
  const clamped = clampChroma({ mode: 'oklch', l, c, h }, 'oklch');
  const hex = formatHex(clamped);
  return answerFromHex(hex);
}

/** Answers are defined by their sRGB hex; LUV and OKLCH are derived from it so all three agree. */
export function answerFromHex(hex: string): ColorAnswer {
  return { hex, luv: hexToLuv(hex), oklch: hexToOklch(hex) };
}

/**
 * CIELUV with a D65 white point (the sRGB white). culori's built-in 'luv' mode is D50-adapted,
 * so we take culori's D65 XYZ and apply the CIE 1976 L*u*v* formulas ourselves.
 */
const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };
const uPrime = (x: number, y: number, z: number) => (4 * x) / (x + 15 * y + 3 * z);
const vPrime = (x: number, y: number, z: number) => (9 * y) / (x + 15 * y + 3 * z);
const UN = uPrime(D65.X, D65.Y, D65.Z);
const VN = vPrime(D65.X, D65.Y, D65.Z);

export function xyzToLuv(x: number, y: number, z: number): Luv {
  const yr = y / D65.Y;
  const l = yr > (6 / 29) ** 3 ? 116 * Math.cbrt(yr) - 16 : (29 / 3) ** 3 * yr;
  const d = x + 15 * y + 3 * z;
  if (d === 0 || l === 0) return [0, 0, 0];
  return [l, 13 * l * (uPrime(x, y, z) - UN), 13 * l * (vPrime(x, y, z) - VN)];
}

export function hexToLuv(hex: string): Luv {
  const c = toXyz65(parse(hex)!);
  const [l, u, v] = xyzToLuv(c.x ?? 0, c.y ?? 0, c.z ?? 0);
  return [round(l), round(u), round(v)];
}

export function hexToOklch(hex: string): Oklch {
  const c = toOklch(parse(hex)!);
  return [round(c.l ?? 0), round(c.c ?? 0), round(c.h ?? 0, 2)];
}

export function oklchToHex([l, c, h]: Oklch): string {
  return formatHex(clampChroma({ mode: 'oklch', l, c, h }, 'oklch'));
}

/** Displayable sRGB 0-1 triplet, gamut clamped. */
export function oklchToRgb01([l, c, h]: Oklch): [number, number, number] {
  const rgb = toRgb(clampChroma({ mode: 'oklch', l, c, h }, 'oklch'));
  const cl = (x: number | undefined) => Math.min(1, Math.max(0, x ?? 0));
  return [cl(rgb.r), cl(rgb.g), cl(rgb.b)];
}

export function hexToRgb01(hex: string): [number, number, number] {
  const rgb = toRgb(parse(hex)!);
  return [rgb.r, rgb.g, rgb.b];
}

/** ΔE as Euclidean distance in CIELUV (Rothen et al. 2013 recommendation). */
export function deltaELuv(a: Luv, b: Luv): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function oklchToLuv(c: Oklch): Luv {
  const xyz = toXyz65({ mode: 'oklch', l: c[0], c: c[1], h: c[2] });
  return xyzToLuv(xyz.x ?? 0, xyz.y ?? 0, xyz.z ?? 0);
}

/** Unclamped ΔE between two OKLCH colors, measured in CIELUV. */
export function deltaEOklch(a: Oklch, b: Oklch): number {
  return deltaELuv(oklchToLuv(a), oklchToLuv(b));
}

export function oklchToOklab([l, c, h]: Oklch): [number, number, number] {
  const r = (h * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
}

export function oklabToOklch([l, a, b]: [number, number, number]): Oklch {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [l, c, c < 1e-6 ? 0 : h];
}

/** Weighted mean in OKLab (handles hue wrap-around correctly), returned as OKLCH. */
export function meanOklch(colors: Oklch[], weights?: number[]): Oklch | null {
  if (colors.length === 0) return null;
  let sw = 0;
  const acc: [number, number, number] = [0, 0, 0];
  colors.forEach((c, i) => {
    const w = weights ? weights[i] : 1;
    const lab = oklchToOklab(c);
    acc[0] += lab[0] * w;
    acc[1] += lab[1] * w;
    acc[2] += lab[2] * w;
    sw += w;
  });
  if (sw <= 0) return null;
  return oklabToOklch([acc[0] / sw, acc[1] / sw, acc[2] / sw]);
}

/**
 * Representative color for a set of answers, used for palette anchors and live blending.
 *
 * Averaging in OKLab (meanOklch) is right for statistics, but it makes a muddy gray when the
 * answers disagree (blue + yellow → gray), a color the person never picked. Here:
 *  - lightness and colorfulness are averaged directly, so the result is as vivid as the answers;
 *  - hue is the circular mean, weighted by colorfulness (grays barely vote on hue);
 *  - if the hues disagree too much to average (agreement below `minAgreement`, about 120° apart for
 *    two equal answers), the result is instead the medoid: the actual answer closest to the others
 *    (ΔE in CIELUV), or the one with the largest weight. Ties go to the later answer.
 */
export function representativeColor(colors: Oklch[], weights?: number[], minAgreement = 0.5): Oklch | null {
  const w = weights ?? colors.map(() => 1);
  const idx = colors.map((_, i) => i).filter((i) => w[i] > 0);
  if (idx.length === 0) return null;
  if (idx.length === 1) return colors[idx[0]];
  let sw = 0, sl = 0, sc = 0, hx = 0, hy = 0, swc = 0;
  for (const i of idx) {
    const [l, c, h] = colors[i];
    const r = (h * Math.PI) / 180;
    sw += w[i];
    sl += w[i] * l;
    sc += w[i] * c;
    hx += w[i] * c * Math.cos(r);
    hy += w[i] * c * Math.sin(r);
    swc += w[i] * c;
  }
  const L = sl / sw;
  const C = sc / sw;
  if (swc < 1e-6) return [L, C, 0];
  const agreement = Math.hypot(hx, hy) / swc;
  if (agreement >= minAgreement) {
    let h = (Math.atan2(hy, hx) * 180) / Math.PI;
    if (h < 0) h += 360;
    return [L, C, h];
  }
  if (weights) {
    // Live blending: the dominant color wins.
    let best = idx[0];
    for (const i of idx) if (w[i] >= w[best]) best = i;
    return colors[best];
  }
  const luvs = idx.map((i) => oklchToLuv(colors[i]));
  let best = 0;
  let bestD = Infinity;
  luvs.forEach((a, j) => {
    const d = luvs.reduce((s, b) => s + deltaELuv(a, b), 0);
    if (d <= bestD + 1e-9) {
      best = j;
      bestD = d;
    }
  });
  return colors[idx[best]];
}

/** Shortest signed hue difference b - a, in (-180, 180]. */
export function hueDelta(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function lerpHue(a: number, b: number, t: number): number {
  const h = a + hueDelta(a, b) * t;
  return ((h % 360) + 360) % 360;
}

/** WCAG relative luminance from sRGB 0-1. */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** A short plain-language name for screen readers and the text palette, e.g. "light blue". */
export function describeColor([l, c, h]: Oklch): string {
  if (c < 0.03) {
    if (l > 0.93) return 'white';
    if (l < 0.25) return 'black';
    return l > 0.65 ? 'light gray' : l < 0.45 ? 'dark gray' : 'gray';
  }
  const names: [number, string][] = [
    [20, 'pink'], [45, 'red'], [70, 'orange'], [100, 'yellow'], [135, 'yellow-green'],
    [165, 'green'], [200, 'teal'], [235, 'cyan'], [275, 'blue'], [305, 'indigo'],
    [330, 'purple'], [360, 'magenta'],
  ];
  let name = names.find(([max]) => h < max)?.[1] ?? 'pink';
  if (name === 'orange' && l < 0.55) name = 'brown';
  const tone = l > 0.8 ? 'light ' : l < 0.45 ? 'dark ' : '';
  const sat = c < 0.07 ? 'muted ' : '';
  return `${tone}${sat}${name}`;
}

/* ------------------------------------------------------------------ */
/* Fast OKLCH → sRGB for drawing the picker (thousands of pixels)      */
/* ------------------------------------------------------------------ */

/** OKLCH → linear sRGB (Björn Ottosson's OKLab matrices). Values outside 0–1 are out of gamut. */
export function oklchToLinearSrgb(l: number, c: number, h: number): [number, number, number] {
  const r = (h * Math.PI) / 180;
  const a = c * Math.cos(r);
  const b = c * Math.sin(r);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const EPS = 1e-4;
export function inSrgbGamut(l: number, c: number, h: number): boolean {
  const [r, g, b] = oklchToLinearSrgb(l, c, h);
  return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

/** The most colorful chroma an sRGB screen can show at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  if (l <= 0 || l >= 1) return 0;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** sRGB gamma encoding, 0–1 linear → 0–255. */
export function encodeSrgb8(x: number): number {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}
