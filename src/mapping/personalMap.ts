/**
 * Personal mapping: anchors (mean answer per timbre × pitch) → a color for any pitch and timbre mix.
 */
import { MAP_MIDI_MAX, MAP_MIDI_MIN, MISSING_TIMBRE_CHROMA_SCALE, PITCHES_MIDI, TIMBRES } from '../config/stimuli';
import type { Answer, Fingerprint, Oklch, Stimulus, Timbre } from '../types';
import { lerpHue, meanOklch, oklabToOklch, oklchToOklab } from '../science/color';
import { defaultColor } from './defaultMap';

export type Anchors = Fingerprint['anchors'];

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Mean of the user's answers per timbre and pitch, in OKLCH (averaged in OKLab). */
export function buildAnchors(answers: Answer[], stimuli: Stimulus[]): Anchors {
  const out: Anchors = {};
  for (const t of TIMBRES) {
    out[t] = {};
    for (const midi of PITCHES_MIDI) {
      const ids = new Set(stimuli.filter((s) => s.timbre === t && s.midi === midi).map((s) => s.id));
      const cols = answers.filter((a) => ids.has(a.stimulusId) && a.color).map((a) => a.color!.oklch);
      const m = meanOklch(cols);
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
  return meanOklch(
    valid.map(([c]) => c),
    valid.map(([, w]) => w),
  )!;
}

/**
 * Exponential smoother in OKLab so the output color never flickers.
 * tauMs is the time constant (≈150 ms per spec).
 */
export class ColorSmoother {
  private lab: [number, number, number] | null = null;
  constructor(private tauMs: number) {}
  update(target: Oklch, dtMs: number): Oklch {
    const t = oklchToOklab(target);
    if (!this.lab) this.lab = t;
    else {
      const k = 1 - Math.exp(-dtMs / this.tauMs);
      this.lab = [
        this.lab[0] + (t[0] - this.lab[0]) * k,
        this.lab[1] + (t[1] - this.lab[1]) * k,
        this.lab[2] + (t[2] - this.lab[2]) * k,
      ];
    }
    return oklabToOklch(this.lab);
  }
  reset() {
    this.lab = null;
  }
}
