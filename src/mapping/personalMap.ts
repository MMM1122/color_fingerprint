/**
 * Personal mapping: anchors (mean answer per timbre × pitch) → a color for any pitch and timbre mix.
 */
import { MAP_MIDI_MAX, MAP_MIDI_MIN, MISSING_TIMBRE_CHROMA_SCALE, PITCHES_MIDI, TIMBRES } from '../config/stimuli';
import type { Answer, Fingerprint, Oklch, Stimulus, Timbre } from '../types';
import { lerpHue, representativeColor } from '../science/color';
import { defaultColor } from './defaultMap';

export type Anchors = Fingerprint['anchors'];

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * One color per timbre and pitch from the user's answers: averaged in OKLCH so it stays as vivid as
 * the answers, or the middle answer when they disagree too much to average (see representativeColor).
 */
export function buildAnchors(answers: Answer[], stimuli: Stimulus[]): Anchors {
  const out: Anchors = {};
  for (const t of TIMBRES) {
    out[t] = {};
    for (const midi of PITCHES_MIDI) {
      const ids = new Set(stimuli.filter((s) => s.timbre === t && s.midi === midi).map((s) => s.id));
      const cols = answers.filter((a) => ids.has(a.stimulusId) && a.color).map((a) => a.color!.oklch);
      const m = representativeColor(cols);
      out[t][midi] = m ? [r4(m[0]), r4(m[1]), Math.round(m[2] * 100) / 100] : null;
    }
  }
  return out;
}

/** Interpolate two OKLCH colors: L and C linearly, hue the short way round. */
export function lerpOklch(a: Oklch, b: Oklch, t: number): Oklch {
  // A near-gray color has no meaningful hue; borrow the other side's hue so we don't swing through the wheel.
  const GRAY = 0.02;
  const ha = a[1] < GRAY ? b[2] : a[2];
  const hb = b[1] < GRAY ? a[2] : b[2];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, lerpHue(ha, hb, t)];
}

export type ResolvedTimbre = { points: { midi: number; color: Oklch }[]; missing: boolean };

/** Fill null anchors from neighbours; mark a timbre missing if it has no anchors at all. */
export function resolveAnchors(anchors: Anchors): Record<Timbre, ResolvedTimbre> {
  const out = {} as Record<Timbre, ResolvedTimbre>;
  for (const t of TIMBRES) {
    const row = anchors[t] ?? {};
    const known = PITCHES_MIDI.filter((m) => row[m]).map((m) => ({ midi: m, color: row[m]! }));
    if (known.length === 0) {
      out[t] = {
        missing: true,
        points: PITCHES_MIDI.map((m) => ({ midi: m, color: defaultColor(t, m, MISSING_TIMBRE_CHROMA_SCALE) })),
      };
      continue;
    }
    // Interpolating between known neighbours (and clamping at the ends) fills the gaps.
    out[t] = {
      missing: false,
      points: PITCHES_MIDI.map((m) => ({ midi: m, color: row[m] ?? interpolate(known, m) })),
    };
  }
  return out;
}

function interpolate(points: { midi: number; color: Oklch }[], midi: number): Oklch {
  const m = Math.min(MAP_MIDI_MAX, Math.max(MAP_MIDI_MIN, midi));
  if (m <= points[0].midi) return points[0].color;
  const last = points[points.length - 1];
  if (m >= last.midi) return last.color;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (m >= a.midi && m <= b.midi) return lerpOklch(a.color, b.color, (m - a.midi) / (b.midi - a.midi));
  }
  return last.color;
}

export type ColorMap = {
  colorFor(timbre: Timbre, midi: number): Oklch;
  /** Final color = timbre colors at this pitch blended (in OKLab) by timbre weights. */
  blend(midi: number, weights: Record<Timbre, number>): Oklch;
  missingTimbres: Timbre[];
};

export function makePersonalMap(anchors: Anchors): ColorMap {
  const resolved = resolveAnchors(anchors);
  const colorFor = (t: Timbre, midi: number) => interpolate(resolved[t].points, midi);
  return {
    colorFor,
    blend: (midi, weights) => blendColors(TIMBRES.map((t) => [colorFor(t, midi), weights[t] ?? 0])),
    missingTimbres: TIMBRES.filter((t) => resolved[t].missing),
  };
}

export function makeDefaultMap(): ColorMap {
  return {
    colorFor: defaultColor,
    blend: (midi, weights) => blendColors(TIMBRES.map((t) => [defaultColor(t, midi), weights[t] ?? 0])),
    missingTimbres: [],
  };
}

export function blendColors(items: [Oklch, number][]): Oklch {
  const valid = items.filter(([, w]) => w > 0);
  if (valid.length === 0) return items[0][0];
  return representativeColor(
    valid.map(([c]) => c),
    valid.map(([, w]) => w),
  )!;
}

/**
 * Exponential smoother so the output color never flickers. tauMs is the time constant (≈150 ms per
 * spec). Works in OKLCH (hue the short way round) so a change from blue to yellow passes through
 * green rather than a dull gray.
 */
export class ColorSmoother {
  private c: Oklch | null = null;
  constructor(private tauMs: number) {}
  update(target: Oklch, dtMs: number): Oklch {
    if (!this.c) this.c = target;
    else this.c = lerpOklch(this.c, target, 1 - Math.exp(-dtMs / this.tauMs));
    return this.c;
  }
  reset() {
    this.c = null;
  }
}
