/**
 * Timbre matching: the calibration sounds double as reference examples. Live frames are compared
 * with one reference vector per timbre; softmax turns distances into weights.
 * This is an APPROXIMATION ("closest to piano / strings / pure tone"), never instrument recognition.
 */
import { ANALYSIS, TIMBRES, midiToHz } from '../config/stimuli';
import type { Timbre } from '../types';
import type { FrameFeatures } from './features';

export type TimbreWeights = Record<Timbre, number>;

/**
 * Feature vector: MFCC 1-12 (MFCC 0 is overall energy, so it is dropped), spectral centroid as
 * log2(centroid / f0) so it describes brightness rather than note height, and the envelope slope.
 *
 * ADDITION TO SPEC (flagged): the envelope slope (dB/s) is not in the spec's feature list. Without
 * it, overlapping piano notes in real music look "rich" and were labelled strings most of the time.
 * Decay vs. sustain survives overlapping notes, so it gets extra weight in the distance.
 */
export function timbreVector(f: FrameFeatures): number[] | null {
  if (f.silent || f.midi == null || !f.mfcc || f.mfcc.some((x) => !Number.isFinite(x))) return null;
  const f0 = f.pitchHz ?? midiToHz(f.midi);
  const brightness = Math.log2(Math.max(1, f.centroidHz) / f0);
  return [...f.mfcc.slice(1, 13), brightness, f.decay];
}

/** Per-dimension weights for the distance: 12 MFCCs, brightness, envelope slope. */
export const FEATURE_WEIGHTS = [...new Array(12).fill(1), 1, 6];

/**
 * One reference vector per calibration sample (timbre × pitch), standardized globally.
 *
 * DEPARTURE FROM SPEC (flagged for the owner): the spec stores one vector per timbre. MFCCs shift
 * strongly with pitch, so a single averaged vector confused low piano with sine and high sine with
 * piano (weights near 1/3 each). Here each timbre's reference is interpolated to the live pitch,
 * so a frame is always compared with each timbre *at the same pitch*.
 */
export type TimbreReferences = {
  byTimbre: Record<Timbre, { midi: number; vec: number[] }[]>;
  mean: number[];
  std: number[];
};

export function buildReferences(frames: { timbre: Timbre; midi: number; vector: number[] }[]): TimbreReferences {
  const dim = frames[0].vector.length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const f of frames) f.vector.forEach((v, i) => (mean[i] += v / frames.length));
  for (const f of frames) f.vector.forEach((v, i) => (std[i] += (v - mean[i]) ** 2 / frames.length));
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i]) || 1;
  const byTimbre = {} as TimbreReferences['byTimbre'];
  for (const t of TIMBRES) {
    const pitches = [...new Set(frames.filter((f) => f.timbre === t).map((f) => f.midi))].sort((a, b) => a - b);
    byTimbre[t] = pitches.map((midi) => {
      const own = frames.filter((f) => f.timbre === t && f.midi === midi);
      const acc = new Array(dim).fill(0);
      for (const f of own) f.vector.forEach((v, i) => (acc[i] += (v - mean[i]) / std[i] / own.length));
      return { midi, vec: acc };
    });
  }
  return { byTimbre, mean, std };
}

function referenceAt(list: { midi: number; vec: number[] }[], midi: number): number[] {
  if (midi <= list[0].midi) return list[0].vec;
  const last = list[list.length - 1];
  if (midi >= last.midi) return last.vec;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (midi <= b.midi) {
      const t = (midi - a.midi) / (b.midi - a.midi);
      return a.vec.map((v, k) => v + (b.vec[k] - v) * t);
    }
  }
  return last.vec;
}

export function timbreDistances(vector: number[], r: TimbreReferences, midi: number): TimbreWeights {
  const z = vector.map((v, i) => (v - r.mean[i]) / r.std[i]);
  const out = {} as TimbreWeights;
  for (const t of TIMBRES) {
    const ref = referenceAt(r.byTimbre[t], midi);
    let s = 0;
    let wsum = 0;
    for (let i = 0; i < z.length; i++) {
      const w = FEATURE_WEIGHTS[i] ?? 1;
      s += w * (z[i] - ref[i]) ** 2;
      wsum += w;
    }
    out[t] = Math.sqrt(s / wsum);
  }
  return out;
}

export function softmaxWeights(d: TimbreWeights, temperature: number = ANALYSIS.timbreTemperature): TimbreWeights {
  const min = Math.min(...TIMBRES.map((t) => d[t]));
  const e = TIMBRES.map((t) => Math.exp(-(d[t] - min) / temperature));
  const s = e.reduce((a, b) => a + b, 0);
  const out = {} as TimbreWeights;
  TIMBRES.forEach((t, i) => (out[t] = e[i] / s));
  return out;
}

export function topTimbre(w: TimbreWeights): Timbre {
  return TIMBRES.reduce((best, t) => (w[t] > w[best] ? t : best), TIMBRES[0]);
}

/** Exponential smoothing of weights (~200 ms). Holds the last weights during silence. */
export class WeightSmoother {
  private w: TimbreWeights | null = null;
  constructor(private tauMs: number = ANALYSIS.timbreSmoothingMs) {}
  update(target: TimbreWeights | null, dtMs: number): TimbreWeights {
    if (!target) return this.w ?? (Object.fromEntries(TIMBRES.map((t) => [t, 1 / TIMBRES.length])) as TimbreWeights);
    if (!this.w) this.w = { ...target };
    else {
      const k = 1 - Math.exp(-dtMs / this.tauMs);
      for (const t of TIMBRES) this.w[t] += (target[t] - this.w[t]) * k;
    }
    return { ...this.w };
  }
}
