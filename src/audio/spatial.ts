/**
 * Stereo ("spatial") analysis for the visualizer. Pure, so it is unit-tested.
 *
 *  - pan:   where the sound sits, −1 (left) … 0 (centre) … +1 (right), from the energy balance
 *           between the channels.
 *  - width: how spread out it is, 0 (narrow, both channels the same) … 1 (wide, the channels are
 *           unrelated, as with reverb or a spacious mix). From the inter-channel correlation.
 *  - notePan: pan measured only at the current note's harmonics, so in a mix the piano on the left
 *           and the strings on the right land in different places.
 *
 * Mono sources (microphone, the calibration sounds) give pan 0 and width 0: `active` stays false
 * and the visuals keep their usual spread.
 */
import Meyda from 'meyda';
import { ANALYSIS } from '../config/stimuli';

export type Spatial = { pan: number; width: number; notePan: number | null; level: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Energy-balance pan: (R² − L²) / (R² + L²). */
export function panOf(l: Float32Array, r: Float32Array): { pan: number; width: number; level: number } {
  let el = 0;
  let er = 0;
  let lr = 0;
  for (let i = 0; i < l.length; i++) {
    el += l[i] * l[i];
    er += r[i] * r[i];
    lr += l[i] * r[i];
  }
  const total = el + er;
  const level = Math.sqrt(total / (2 * l.length));
  if (total < 1e-9) return { pan: 0, width: 0, level: 0 };
  const pan = (er - el) / total;
  // Correlation is only meaningful when both channels carry sound; a hard-panned source is narrow.
  const quieter = Math.min(el, er) / Math.max(el, er);
  const corr = quieter < 1e-3 ? 1 : lr / Math.sqrt(el * er);
  const width = clamp(1 - corr, 0, 1);
  return { pan: clamp(pan, -1, 1), width, level };
}

function spectrum(frame: Float32Array, sampleRate: number): Float32Array {
  const m = Meyda as any;
  m.bufferSize = frame.length;
  m.sampleRate = sampleRate;
  // Copy: Meyda may reuse its output buffer between calls.
  return Float32Array.from(m.extract('amplitudeSpectrum', frame) as Float32Array);
}

/** Pan measured at the note's first four harmonics (±1 bin), or null if there's too little energy there. */
export function notePanOf(l: Float32Array, r: Float32Array, f0: number, sampleRate: number): number | null {
  const sl = spectrum(l, sampleRate);
  const sr = spectrum(r, sampleRate);
  const binHz = sampleRate / l.length;
  let el = 0;
  let er = 0;
  for (let h = 1; h <= 4; h++) {
    const k = Math.round((f0 * h) / binHz);
    for (let d = -1; d <= 1; d++) {
      const i = k + d;
      if (i <= 0 || i >= sl.length) continue;
      el += sl[i] * sl[i];
      er += sr[i] * sr[i];
    }
  }
  if (el + er < 1e-6) return null;
  return clamp((er - el) / (er + el), -1, 1);
}

/** Smooths pan and width over time and decides whether the source is really stereo. */
export class SpatialTracker {
  pan = 0;
  width = 0;
  private activity = 0;

  constructor(private sampleRate: number) {}

  step(l: Float32Array, r: Float32Array, f0: number | null, dtMs: number): Spatial & { active: boolean } {
    const base = panOf(l, r);
    const silent = base.level < ANALYSIS.silenceRms;
    const notePan = !silent && f0 ? notePanOf(l, r, f0, this.sampleRate) : null;
    if (!silent) {
      const target = notePan ?? base.pan;
      this.pan += (target - this.pan) * (1 - Math.exp(-dtMs / 120));
      this.width += (base.width - this.width) * (1 - Math.exp(-dtMs / 300));
      const stereoNow = Math.abs(base.pan) > 0.05 || base.width > 0.05 ? 1 : 0;
      this.activity += (stereoNow - this.activity) * (1 - Math.exp(-dtMs / 500));
    }
    return { pan: this.pan, width: this.width, notePan, level: base.level, active: this.activity > 0.5 };
  }
}

/** Plain words for the on-screen readout. */
export function sideWord(pan: number): string | null {
  if (pan < -0.25) return 'on the left';
  if (pan > 0.25) return 'on the right';
  return null;
}
