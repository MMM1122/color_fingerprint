/** Trial randomization: every stimulus REPETITIONS times, random order, never the same stimulus twice in a row. */
import type { Stimulus } from '../types';

export type Trial = { stimulusId: string; repetition: 1 | 2 | 3 };

/** Small seeded PRNG so orders are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Greedy weighted draw: at each step pick a stimulus (≠ previous) with probability proportional
 * to its remaining count. Weighting by remaining count keeps dead ends rare; on a dead end we restart.
 */
export function generateTrialOrder(
  stimuli: Pick<Stimulus, 'id'>[],
  repetitions: number,
  rng: () => number = Math.random,
): Trial[] {
  if (stimuli.length < 2 && repetitions > 1) {
    throw new Error('Need at least 2 stimuli to avoid back-to-back repeats.');
  }
  for (let attempt = 0; attempt < 1000; attempt++) {
    const remaining = new Map(stimuli.map((s) => [s.id, repetitions]));
    const seen = new Map<string, number>();
    const order: Trial[] = [];
    let prev: string | null = null;
    let ok = true;
    const total = stimuli.length * repetitions;
    for (let i = 0; i < total; i++) {
      const candidates = [...remaining.entries()].filter(([id, n]) => n > 0 && id !== prev);
      if (candidates.length === 0) {
        ok = false;
        break;
      }
      const sum = candidates.reduce((s, [, n]) => s + n, 0);
      let r = rng() * sum;
      let pick = candidates[candidates.length - 1][0];
      for (const [id, n] of candidates) {
        r -= n;
        if (r < 0) {
          pick = id;
          break;
        }
      }
      remaining.set(pick, remaining.get(pick)! - 1);
      const rep = (seen.get(pick) ?? 0) + 1;
      seen.set(pick, rep);
      order.push({ stimulusId: pick, repetition: rep as 1 | 2 | 3 });
      prev = pick;
    }
    if (ok) return order;
  }
  throw new Error('Could not generate a valid trial order.');
}

export function hasBackToBack(order: Trial[]): boolean {
  return order.some((t, i) => i > 0 && order[i - 1].stimulusId === t.stimulusId);
}
