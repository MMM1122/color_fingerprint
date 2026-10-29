/**
 * Single source of truth for the calibration test and all tunable thresholds.
 * Researchers can change stimuli, repetitions and pattern rules here without touching other code.
 */
import type { Stimulus, Timbre } from '../types';

export const TIMBRES: readonly Timbre[] = ['piano', 'sine', 'strings'] as const;

export const TIMBRE_LABELS: Record<Timbre, string> = {
  piano: 'Piano',
  sine: 'Pure tone',
  strings: 'Bowed strings',
};

/** C3, A3, F4, D5, B5: about 3 octaves, all different note names. */
export const PITCHES_MIDI = [48, 57, 65, 74, 83] as const;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export const REPETITIONS = 3;
export const STIMULUS_DURATION_MS = 1500;
export const FADE_MS = 50;
/** Auto-play once, then the user may replay up to this many times. */
export const MAX_REPLAYS = 3;

/**
 * Optional sample files per timbre. When a file is set (e.g. 'samples/piano-C3.wav' in public/),
 * it is used instead of the in-browser synthesized placeholder. Every file must be openly
 * licensed and listed in ATTRIBUTION.md. See README "Swapping in real samples".
 */
export const SAMPLE_FILES: Partial<Record<Timbre, Partial<Record<number, string>>>> = {};

export const STIMULI: Stimulus[] = TIMBRES.flatMap((timbre) =>
  PITCHES_MIDI.map((midi) => ({
    id: `${timbre}-${midiToName(midi)}`,
    timbre,
    midi,
    file: SAMPLE_FILES[timbre]?.[midi],
    durationMs: STIMULUS_DURATION_MS,
  })),
);

/** Target loudness for every stimulus and built-in track (ITU-R BS.1770 K-weighted, LUFS-like). */
export const TARGET_LOUDNESS_LUFS = -23;

/* ------------------------------------------------------------------ */
/* Scoring and research reference points                               */
/* ------------------------------------------------------------------ */

/**
 * VERIFIED (Oct 29 2026) against secondary sources citing Rothen, Seth, Witzel & Ward (2013),
 * J Neurosci Methods 215:156-160, and Eagleman et al. (2007):
 *  - Rothen et al. recommend Euclidean distance in CIELUV with a cutoff of 135.
 *  - Eagleman et al. use RGB normalized to 0-1 with a cutoff of 1.0.
 *  - IMPORTANT: both scores SUM the distances of the three pairwise comparisons per item,
 *    then average over items. The spec's per-stimulus score is the MEAN pairwise distance,
 *    so the equivalent cutoff on our scale is 135 / 3 = 45. We store both.
 *  - Both thresholds were validated for graphemes (letters/digits), not sounds. Context only.
 */
export const RESEARCH_REFERENCE = {
  rothenLuvSumCutoff: 135,
  rothenLuvMeanCutoff: 135 / 3,
  eaglemanRgbSumCutoff: 1.0,
  validatedFor: 'letters and digits',
} as const;

/** Plain-language consistency bands, on the spec's mean-pairwise CIELUV scale. */
export const CONSISTENCY_BANDS = {
  /** Below the research reference point (45 on our scale). */
  veryClose: RESEARCH_REFERENCE.rothenLuvMeanCutoff,
  /** TODO(owner): 2x the reference point is a design choice, not a published value. */
  fairlyClose: RESEARCH_REFERENCE.rothenLuvMeanCutoff * 2,
} as const;

/** If more than this fraction of answers are null, the score is flagged as less reliable. */
export const NULL_RELIABILITY_FRACTION = 1 / 3;

export const PATTERN_RULES = {
  pitchLightnessMinRho: 0.5,
  timbreHueMinGapDeg: 30,
  /** Minimum OKLCH chroma for a timbre's mean color to have a meaningful hue. Design choice. */
  timbreHueMinChroma: 0.04,
} as const;

/* ------------------------------------------------------------------ */
/* Live audio → color                                                  */
/* ------------------------------------------------------------------ */

export const ANALYSIS = {
  frameSize: 2048,
  hopSize: 512,
  /** Pitchy clarity above this counts as "clearly pitched". */
  clarityThreshold: 0.9,
  /** RMS below this is treated as silence. */
  silenceRms: 0.004,
  /** Softmax temperature for timbre weights (lower = more decisive). Tuned so a pure sine gets ~97% sine weight. */
  timbreTemperature: 0.12,
  timbreSmoothingMs: 200,
  colorSmoothingMs: 150,
  /** Spectral-flux z-score above which a frame counts as an onset. */
  onsetThreshold: 2.2,
  onsetMinGapMs: 90,
} as const;

/** Clamp range for the personal mapping. */
export const MAP_MIDI_MIN = PITCHES_MIDI[0];
export const MAP_MIDI_MAX = PITCHES_MIDI[PITCHES_MIDI.length - 1];

/** Chroma multiplier when a whole timbre is missing and the default mapping fills in. */
export const MISSING_TIMBRE_CHROMA_SCALE = 0.4;

/* ------------------------------------------------------------------ */
/* Safety (WCAG 2.3.1)                                                 */
/* ------------------------------------------------------------------ */

export const SAFETY = {
  maxFlashesPerSecond: 3,
  /** WCAG general-flash definition: a pair of opposing changes of ≥10% relative luminance. */
  flashLuminanceDelta: 0.1,
  /** ... where the darker image is below 0.80 relative luminance. */
  flashDarkerBelow: 0.8,
  /** Max change in overall scene luminance per second (normal / reduced motion). */
  maxLuminanceSlewPerSec: 0.45,
  maxLuminanceSlewPerSecReduced: 0.2,
  /** Upper bound on scene luminance contributed by visuals. */
  maxSceneLuminance: 0.6,
} as const;
