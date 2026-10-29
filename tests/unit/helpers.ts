import type { Answer, ColorAnswer, Luv } from '../../src/types';
import { answerFromHex } from '../../src/science/color';

let t = 0;
export function ans(stimulusId: string, repetition: 1 | 2 | 3, color: ColorAnswer | null): Answer {
  return { stimulusId, repetition, color, reactionMs: 1000, replays: 0, timestamp: new Date(t++).toISOString() };
}

/** A color answer with explicit LUV coordinates (hex/oklch are placeholders) for hand-computed fixtures. */
export function luv(l: number, u: number, v: number): ColorAnswer {
  return { hex: '#808080', luv: [l, u, v] as Luv, oklch: [0.6, 0, 0] };
}

export const hex = answerFromHex;
