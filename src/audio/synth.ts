/**
 * Pure-JS synthesis of the three calibration timbres. These are PLACEHOLDERS for openly licensed
 * instrument samples (spec section 3, open decision in section 11). They run in the browser and in
 * Node (for tests), and need no license. Swap in real samples via SAMPLE_FILES in config/stimuli.ts.
 */
import { FADE_MS, midiToHz } from '../config/stimuli';
import type { Timbre } from '../types';

export type ToneOptions = {
  durationMs: number;
  fadeMs?: number;
  /** 0-1 amplitude scale before loudness normalization. */
  velocity?: number;
  /** Phase seed so repeated notes in tracks are not sample-identical. */
  seed?: number;
};

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Body-resonance curve for the bowed-string placeholder (rough violin/cello body peaks). */
function stringBody(hz: number): number {
  const peak = (f0: number, bw: number, g: number) => g / (1 + ((hz - f0) / bw) ** 2);
  return 0.35 + peak(280, 120, 0.9) + peak(1000, 400, 0.7) + peak(2800, 900, 0.6);
}

export function renderTone(timbre: Timbre, midi: number, sampleRate: number, opts: ToneOptions): Float32Array {
  const n = Math.round((opts.durationMs / 1000) * sampleRate);
  const out = new Float32Array(n);
  const f0 = midiToHz(midi);
  const nyq = sampleRate / 2;
  const vel = opts.velocity ?? 1;
  const r = rand(opts.seed ?? midi * 7919 + 1);
  const twoPi = 2 * Math.PI;

  if (timbre === 'sine') {
    const w = (twoPi * f0) / sampleRate;
    for (let i = 0; i < n; i++) out[i] = Math.sin(w * i);
  } else if (timbre === 'piano') {
    // Stiff-string partials (slight inharmonicity), brighter at onset, upper partials decay faster.
    const B = 0.00035;
    const decayBase = 0.9 + (midi - 48) * 0.06; // higher notes decay faster
    for (let k = 1; k <= 16; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > nyq * 0.9) break;
      const amp = (1 / k ** 1.15) * (k === 1 ? 1 : 0.9);
      const decay = decayBase * (1 + 0.35 * (k - 1));
      const w = (twoPi * fk) / sampleRate;
      const ph = (r() + 1) * Math.PI;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        out[i] += amp * Math.exp(-decay * t) * Math.sin(w * i + ph);
      }
    }
    // Short hammer thump.
    const thumpLen = Math.min(n, Math.round(0.012 * sampleRate));
    for (let i = 0; i < thumpLen; i++) out[i] += 0.08 * r() * (1 - i / thumpLen);
  } else {
    // Bowed string: sawtooth-like harmonics shaped by a body curve, with vibrato and bow noise.
    const vibRate = 5.3;
    const vibDepth = 0.0035;
    const vibOnset = 0.25;
    const partials: { k: number; amp: number; ph: number }[] = [];
    for (let k = 1; k <= 40; k++) {
      if (k * f0 > nyq * 0.9) break;
      partials.push({ k, amp: (1 / k) * stringBody(k * f0), ph: (r() + 1) * Math.PI });
    }
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const vib = 1 + vibDepth * Math.min(1, t / vibOnset) * Math.sin(twoPi * vibRate * t);
      phase += (twoPi * f0 * vib) / sampleRate;
      let s = 0;
      for (const p of partials) s += p.amp * Math.sin(p.k * phase + p.ph);
      const attack = Math.min(1, t / 0.12);
      out[i] = s * attack + 0.012 * r();
    }
  }

  applyFades(out, sampleRate, opts.fadeMs ?? FADE_MS);
  for (let i = 0; i < n; i++) out[i] *= vel;
  return out;
}

export function applyFades(buf: Float32Array, sampleRate: number, fadeMs: number): void {
  const f = Math.min(buf.length >> 1, Math.round((fadeMs / 1000) * sampleRate));
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / f);
    buf[i] *= g;
    buf[buf.length - 1 - i] *= g;
  }
}
