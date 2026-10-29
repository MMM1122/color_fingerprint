/**
 * Glue between audio features and color: stimulus rendering, reference building and the per-frame
 * "live audio → color" step. Pure (no Web Audio), so the whole chain is unit-testable.
 */
import { ANALYSIS, STIMULI, TARGET_LOUDNESS_LUFS } from '../config/stimuli';
import type { Oklch, Stimulus, Timbre } from '../types';
import { FeatureExtractor, type FrameFeatures } from './features';
import { normalizeLoudness } from './loudness';
import { renderTone } from './synth';
import {
  buildReferences,
  softmaxWeights,
  timbreDistances,
  timbreVector,
  WeightSmoother,
  type TimbreReferences,
  type TimbreWeights,
} from './timbreMatch';
import { ColorSmoother, type ColorMap } from '../mapping/personalMap';

/** Synthesized placeholder for a stimulus, loudness-normalized. */
export function renderStimulus(s: Stimulus, sampleRate: number): Float32Array {
  const buf = renderTone(s.timbre, s.midi, sampleRate, { durationMs: s.durationMs });
  normalizeLoudness(buf, sampleRate, TARGET_LOUDNESS_LUFS);
  return buf;
}

/** Iterate analysis frames over a buffer. */
export function* frames(buf: Float32Array, size: number = ANALYSIS.frameSize, hop: number = ANALYSIS.hopSize) {
  for (let start = 0; start + size <= buf.length; start += hop) {
    yield { frame: buf.subarray(start, start + size), start };
  }
}

/** Reference vectors from the calibration sounds (skipping fade regions). */
export function referencesFromBuffers(
  items: { stimulus: Stimulus; buffer: Float32Array }[],
  sampleRate: number,
): TimbreReferences {
  const labelled: { timbre: Timbre; midi: number; vector: number[] }[] = [];
  for (const { stimulus, buffer } of items) {
    const fx = new FeatureExtractor(sampleRate);
    const margin = Math.round(0.08 * sampleRate); // skip the 50 ms fades
    for (const { frame, start } of frames(buffer)) {
      if (start < margin || start + frame.length > buffer.length - margin) continue;
      const f = fx.analyze(frame, (start / sampleRate) * 1000);
      const v = timbreVector(f);
      if (v) labelled.push({ timbre: stimulus.timbre, midi: stimulus.midi, vector: v });
    }
  }
  return buildReferences(labelled);
}

export function defaultReferences(sampleRate: number, stimuli: Stimulus[] = STIMULI): TimbreReferences {
  return referencesFromBuffers(
    stimuli.map((s) => ({ stimulus: s, buffer: renderStimulus(s, sampleRate) })),
    sampleRate,
  );
}

export type LiveState = {
  features: FrameFeatures;
  weights: TimbreWeights;
  midi: number | null;
  /** Smoothed output color, or null before any sound. */
  color: Oklch | null;
};

/** Per-frame: features → timbre weights (smoothed) → personal color (smoothed). */
export class LiveMapper {
  private fx: FeatureExtractor;
  private weightSmoother = new WeightSmoother();
  private colorSmoother = new ColorSmoother(ANALYSIS.colorSmoothingMs);
  private lastMidi: number | null = null;
  private lastColor: Oklch | null = null;

  constructor(
    sampleRate: number,
    private refs: TimbreReferences,
    public map: ColorMap,
  ) {
    this.fx = new FeatureExtractor(sampleRate);
  }

  step(frame: Float32Array, nowMs: number, dtMs: number): LiveState {
    const f = this.fx.analyze(frame, nowMs);
    const v = timbreVector(f);
    const target = v && f.midi != null ? softmaxWeights(timbreDistances(v, this.refs, f.midi)) : null;
    const weights = this.weightSmoother.update(target, dtMs);
    if (f.midi != null) this.lastMidi = f.midi;
    if (this.lastMidi != null && !f.silent) {
      this.lastColor = this.colorSmoother.update(this.map.blend(this.lastMidi, weights), dtMs);
    }
    return { features: f, weights, midi: this.lastMidi, color: this.lastColor };
  }
}
