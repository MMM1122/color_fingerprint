/**
 * Per-frame audio features (spec section 4) using Meyda + Pitchy. Pure: works on any Float32Array
 * frame, so the same code runs on live audio, on calibration buffers and in tests.
 */
import Meyda from 'meyda';
import { PitchDetector } from 'pitchy';
import { ANALYSIS, hzToMidi } from '../config/stimuli';

export type FrameFeatures = {
  rms: number;
  pitchHz: number | null;
  clarity: number;
  /** Best estimate of pitch height in MIDI units (fractional), or null in silence. */
  midi: number | null;
  /** Whether `midi` came from a clear pitch (vs. chroma + brightness fallback). */
  pitched: boolean;
  chroma: number[];
  centroidHz: number;
  flatness: number;
  mfcc: number[];
  flux: number;
  /** Envelope slope in dB per second (smoothed). Piano decays; bowed strings and pure tones sustain. */
  decay: number;
  onset: boolean;
  silent: boolean;
};

export class FeatureExtractor {
  private detector: PitchDetector<Float32Array>;
  private prevSpectrum: Float32Array | null = null;
  private fluxMean = 0;
  private fluxVar = 1e-6;
  private lastOnsetMs = -Infinity;
  private prevDb: number | null = null;
  private prevMs: number | null = null;
  private decay = 0;

  constructor(
    private sampleRate: number,
    private frameSize: number = ANALYSIS.frameSize,
  ) {
    this.detector = PitchDetector.forFloat32Array(frameSize);
    this.detector.minVolumeDecibels = -60;
  }

  /** `nowMs` is the frame's timestamp, used for onset spacing. */
  analyze(frame: Float32Array, nowMs: number): FrameFeatures {
    const m = Meyda as any;
    m.bufferSize = this.frameSize;
    m.sampleRate = this.sampleRate;
    m.numberOfMFCCCoefficients = 13;
    const f = m.extract(
      ['rms', 'chroma', 'spectralCentroid', 'spectralFlatness', 'mfcc', 'amplitudeSpectrum'],
      frame,
    ) as {
      rms: number;
      chroma: number[];
      spectralCentroid: number;
      spectralFlatness: number;
      mfcc: number[];
      amplitudeSpectrum: Float32Array;
    };

    const binHz = this.sampleRate / this.frameSize;
    const centroidHz = (Number.isFinite(f.spectralCentroid) ? f.spectralCentroid : 0) * binHz;
    const silent = f.rms < ANALYSIS.silenceRms;

    // Spectral flux on the normalized magnitude spectrum (positive changes only).
    const spec = f.amplitudeSpectrum;
    let flux = 0;
    if (this.prevSpectrum) {
      for (let i = 0; i < spec.length; i++) {
        const d = spec[i] - this.prevSpectrum[i];
        if (d > 0) flux += d;
      }
      flux /= spec.length;
    }
    this.prevSpectrum = Float32Array.from(spec);
    const z = (flux - this.fluxMean) / Math.sqrt(this.fluxVar + 1e-12);
    const onset = !silent && z > ANALYSIS.onsetThreshold && nowMs - this.lastOnsetMs > ANALYSIS.onsetMinGapMs;
    if (onset) this.lastOnsetMs = nowMs;
    const a = 0.05;
    this.fluxMean += a * (flux - this.fluxMean);
    this.fluxVar += a * ((flux - this.fluxMean) ** 2 - this.fluxVar);

    // Envelope slope (dB/s), smoothed over ~120 ms. Rising edges (onsets) are clipped at +20 dB/s.
    const db = 20 * Math.log10(f.rms + 1e-9);
    if (this.prevDb != null && this.prevMs != null && nowMs > this.prevMs && !silent) {
      const slope = Math.max(-80, Math.min(20, ((db - this.prevDb) * 1000) / (nowMs - this.prevMs)));
      const k = 1 - Math.exp(-(nowMs - this.prevMs) / 120);
      this.decay += (slope - this.decay) * k;
    }
    this.prevDb = db;
    this.prevMs = nowMs;

    let pitchHz: number | null = null;
    let clarity = 0;
    if (!silent) {
      const [hz, cl] = this.detector.findPitch(frame, this.sampleRate);
      clarity = cl;
      if (cl >= ANALYSIS.clarityThreshold && hz > 30 && hz < 4500) pitchHz = hz;
    }

    let midi: number | null = null;
    let pitched = false;
    if (pitchHz) {
      midi = hzToMidi(pitchHz);
      pitched = true;
    } else if (!silent && centroidHz > 0) {
      midi = chromaBrightnessPitch(f.chroma, centroidHz);
    }

    return {
      rms: f.rms,
      pitchHz,
      clarity,
      midi,
      pitched,
      chroma: f.chroma,
      centroidHz,
      flatness: Number.isFinite(f.spectralFlatness) ? f.spectralFlatness : 0,
      mfcc: f.mfcc,
      flux,
      decay: this.decay,
      onset,
      silent,
    };
  }
}

/**
 * Fallback for unclear pitch (full mixes): note name from the strongest chroma bin, octave from
 * spectral brightness. Centroids of harmonic sounds sit roughly an octave above the fundamental.
 */
export function chromaBrightnessPitch(chroma: number[], centroidHz: number): number {
  let best = 0;
  for (let i = 1; i < 12; i++) if (chroma[i] > chroma[best]) best = i;
  // Meyda chroma bin 0 = A. Convert to MIDI pitch class (0 = C).
  const pc = (best + 9) % 12;
  const target = hzToMidi(centroidHz) - 12;
  const octave = Math.round((target - pc) / 12);
  return pc + 12 * octave;
}
