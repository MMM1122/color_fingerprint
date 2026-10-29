/**
 * "A generic mapping" for the comparison toggle: lightness rises with pitch, one fixed hue per timbre.
 * This is NOT "what synesthetes see"; it is a neutral baseline.
 */
import { MAP_MIDI_MAX, MAP_MIDI_MIN } from '../config/stimuli';
import type { Oklch, Timbre } from '../types';

export const DEFAULT_HUES: Record<Timbre, number> = { piano: 255, sine: 160, strings: 35 };
export const DEFAULT_CHROMA = 0.13;
export const DEFAULT_L_RANGE: [number, number] = [0.42, 0.88];

export function defaultColor(timbre: Timbre, midi: number, chromaScale = 1): Oklch {
  const t = Math.min(1, Math.max(0, (midi - MAP_MIDI_MIN) / (MAP_MIDI_MAX - MAP_MIDI_MIN)));
  const l = DEFAULT_L_RANGE[0] + t * (DEFAULT_L_RANGE[1] - DEFAULT_L_RANGE[0]);
  return [l, DEFAULT_CHROMA * chromaScale, DEFAULT_HUES[timbre]];
}
