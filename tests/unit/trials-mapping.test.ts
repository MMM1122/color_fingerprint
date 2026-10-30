import { describe, expect, it } from 'vitest';
import { REPETITIONS, STIMULI } from '../../src/config/stimuli';
import { generateTrialOrder, hasBackToBack, mulberry32 } from '../../src/science/trials';
import { buildAnchors, lerpOklch, makePersonalMap } from '../../src/mapping/personalMap';
import { answerFromOklch } from '../../src/science/color';
import { ans } from './helpers';

describe('trial order', () => {
  it('1,000 generated orders never place the same stimulus back to back', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const order = generateTrialOrder(STIMULI, REPETITIONS, rng);
      expect(order.length).toBe(STIMULI.length * REPETITIONS);
      expect(hasBackToBack(order)).toBe(false);
    }
  });

  it('each stimulus appears exactly 3 times with repetitions 1, 2, 3 in order', () => {
    const order = generateTrialOrder(STIMULI, REPETITIONS, mulberry32(1));
    for (const s of STIMULI) {
      expect(order.filter((t) => t.stimulusId === s.id).map((t) => t.repetition)).toEqual([1, 2, 3]);
    }
  });
});

describe('mapping', () => {
  it('hue interpolation goes the short way (350° → 10° passes through 0°)', () => {
    const mid = lerpOklch([0.6, 0.1, 350], [0.6, 0.1, 10], 0.5);
    expect(Math.min(mid[2], 360 - mid[2])).toBeLessThan(1e-9);
    const q = lerpOklch([0.6, 0.1, 350], [0.6, 0.1, 10], 0.25);
    expect(q[2]).toBeCloseTo(355, 9);
  });

  it('interpolates lightness and chroma linearly between anchors and clamps outside C3–B5', () => {
    const answers = STIMULI.flatMap((s) =>
      ([1, 2, 3] as const).map((r) => ans(s.id, r, answerFromOklch([0.3 + ((s.midi - 48) / 35) * 0.5, 0.08, 200]))),
    );
    const map = makePersonalMap(buildAnchors(answers, STIMULI));
    const a3 = map.colorFor('sine', 57);
    const f4 = map.colorFor('sine', 65);
    const mid = map.colorFor('sine', 61);
    expect(mid[0]).toBeCloseTo((a3[0] + f4[0]) / 2, 6);
    expect(map.colorFor('sine', 20)).toEqual(map.colorFor('sine', 48));
    expect(map.colorFor('sine', 120)).toEqual(map.colorFor('sine', 83));
  });

  it('fills missing anchors from neighbours and uses the default map for a missing timbre', () => {
    const answers = STIMULI.filter((s) => s.timbre !== 'strings' && s.timbre !== 'voice').flatMap((s) =>
      ([1, 2, 3] as const).map((r) =>
        ans(s.id, r, s.id === 'piano-F4' ? null : answerFromOklch([0.5, 0.1, 100])),
      ),
    );
    const anchors = buildAnchors(answers, STIMULI);
    expect(anchors.piano[65]).toBeNull();
    const map = makePersonalMap(anchors);
    expect(map.colorFor('piano', 65)[0]).toBeCloseTo(anchors.piano[57]![0], 2);
    expect(map.missingTimbres).toEqual(['strings', 'voice']);
    expect(map.colorFor('strings', 65)[1]).toBeLessThan(0.08); // reduced chroma
  });

  it('blends timbre colors by weight', () => {
    const answers = STIMULI.flatMap((s) =>
      ([1, 2, 3] as const).map((r) => ans(s.id, r, answerFromOklch([0.6, 0.1, s.timbre === 'sine' ? 140 : 300]))),
    );
    const map = makePersonalMap(buildAnchors(answers, STIMULI));
    const onlySine = map.blend(69, { sine: 1, piano: 0, strings: 0, voice: 0 });
    expect(onlySine).toEqual(map.colorFor('sine', 69));
  });
});
