import { describe, expect, it } from 'vitest';
import { STIMULI } from '../../src/config/stimuli';
import {
  consistencyBand,
  detectPatterns,
  scoreConsistency,
  spearman,
  stimulusConsistency,
} from '../../src/science/scoring';
import { answerFromOklch } from '../../src/science/color';
import { mulberry32 } from '../../src/science/trials';
import { ans, luv } from './helpers';

describe('consistency', () => {
  it('three identical answers score 0', () => {
    const c = luv(55, 20, -10);
    expect(stimulusConsistency([ans('x', 1, c), ans('x', 2, c), ans('x', 3, c)])).toBe(0);
  });

  it('matches the hand-calculated fixture (tests/fixtures/consistency-hand-calculation.csv)', () => {
    const answers = [
      ans('A', 1, luv(50, 0, 0)), ans('A', 2, luv(50, 3, 4)), ans('A', 3, luv(50, 0, 0)),
      ans('B', 1, luv(60, 10, 10)), ans('B', 2, luv(60, 10, 10)), ans('B', 3, luv(60, 10, 10)),
      ans('C', 1, luv(40, 0, 0)), ans('C', 2, luv(46, 8, 0)), ans('C', 3, luv(40, 0, 24)),
    ];
    const r = scoreConsistency(answers);
    expect(r.perStimulus.A!.toFixed(2)).toBe('3.33');
    expect(r.perStimulus.B!.toFixed(2)).toBe('0.00');
    expect(r.perStimulus.C!.toFixed(2)).toBe('20.00');
    expect(r.overall!.toFixed(2)).toBe('7.78');
    expect(r.overallLuvSum!.toFixed(2)).toBe('23.33');
  });

  it('excludes stimuli with fewer than 2 colors', () => {
    const answers = [
      ans('A', 1, luv(50, 0, 0)), ans('A', 2, luv(50, 3, 4)), ans('A', 3, null),
      ans('B', 1, luv(60, 0, 0)), ans('B', 2, null), ans('B', 3, null),
    ];
    const r = scoreConsistency(answers);
    expect(r.perStimulus.B).toBeNull();
    expect(r.overall).toBe(5);
    expect(r.scoredStimuli).toBe(1);
  });

  it('flags low reliability only when more than a third of answers are null', () => {
    const third = [
      ans('A', 1, luv(50, 0, 0)), ans('A', 2, luv(50, 0, 0)), ans('A', 3, null),
    ];
    expect(scoreConsistency(third).lowReliability).toBe(false); // exactly 1/3
    const more = [
      ans('A', 1, luv(50, 0, 0)), ans('A', 2, null), ans('A', 3, null),
    ];
    expect(scoreConsistency(more).lowReliability).toBe(true);
  });

  it('bands use the research reference point (45 on the mean scale)', () => {
    expect(consistencyBand(10)).toBe('veryClose');
    expect(consistencyBand(60)).toBe('fairlyClose');
    expect(consistencyBand(120)).toBe('quiteDifferent');
  });
});

describe('patterns', () => {
  const lightnessRising = () =>
    STIMULI.flatMap((s) => {
      const l = 0.3 + ((s.midi - 48) / 35) * 0.6;
      const c = answerFromOklch([l, 0.1, { piano: 250, sine: 140, strings: 30, voice: 320 }[s.timbre]]);
      return ([1, 2, 3] as const).map((r) => ans(s.id, r, c));
    });

  it('lightness rising with pitch gives ρ ≥ 0.5', () => {
    const p = detectPatterns(lightnessRising(), STIMULI, 5);
    expect(p.pitchLightnessRho!).toBeGreaterThanOrEqual(0.5);
    expect(p.pitchLightness).toBe(true);
  });

  it('a shuffled version does not', () => {
    const rng = mulberry32(7);
    const base = lightnessRising();
    const ls = STIMULI.map((s) => 0.3 + ((s.midi - 48) / 35) * 0.6);
    // Shuffle lightness values across stimuli until the correlation is clearly broken.
    let shuffled = [...ls];
    let rho = 1;
    while (rho >= 0.2) {
      shuffled = [...ls].sort(() => rng() - 0.5);
      rho = spearman(STIMULI.map((s) => s.midi), shuffled)!;
    }
    const answers = base.map((a) => {
      const i = STIMULI.findIndex((s) => s.id === a.stimulusId);
      return { ...a, color: answerFromOklch([shuffled[i], 0.1, 200]) };
    });
    const p = detectPatterns(answers, STIMULI, 80);
    expect(p.pitchLightnessRho!).toBeLessThan(0.5);
    expect(p.pitchLightness).toBe(false);
  });

  it('detects timbre → hue gaps above 30° and ignores near-gray timbres', () => {
    const p = detectPatterns(lightnessRising(), STIMULI, 80);
    expect(p.timbreHue.length).toBe(6); // every pair of the 4 timbres
    const gray = STIMULI.flatMap((s) =>
      ([1, 2, 3] as const).map((r) => ans(s.id, r, answerFromOklch([0.6, 0.01, s.timbre === 'piano' ? 0 : 180]))),
    );
    expect(detectPatterns(gray, STIMULI, 80).timbreHue.length).toBe(0);
  });

  it('reports "no clear pattern" when nothing applies', () => {
    const flat = STIMULI.flatMap((s) =>
      ([1, 2, 3] as const).map((r) => ans(s.id, r, answerFromOklch([0.6, 0.1, 200]))),
    );
    const p = detectPatterns(flat, STIMULI, 90);
    expect(p.none).toBe(true);
  });
});

describe('retest', () => {
  it('compares two sessions: within-session scores and the shift between sessions', async () => {
    const { compareSessions, retestDue, reminderIcs } = await import('../../src/science/retest');
    const s1 = {
      startedAt: '2026-10-01T10:00:00Z',
      answers: [
        { ...ans('A', 1, answerFromOklch([0.6, 0.1, 200])), timestamp: '2026-10-01T10:00:00Z' },
        { ...ans('A', 2, answerFromOklch([0.6, 0.1, 200])), timestamp: '2026-10-01T10:01:00Z' },
      ],
    };
    const s2 = {
      startedAt: '2026-10-04T10:00:00Z',
      answers: [
        { ...ans('A', 1, answerFromOklch([0.6, 0.1, 200])), timestamp: '2026-10-04T10:00:00Z' },
        { ...ans('A', 2, answerFromOklch([0.6, 0.1, 200])), timestamp: '2026-10-04T10:01:00Z' },
      ],
    };
    const same = compareSessions(s1, s2);
    expect(same.before).toBe(0);
    expect(same.after).toBe(0);
    expect(same.between).toBeCloseTo(0, 6);
    expect(same.compared).toBe(1);
    expect(same.daysApart).toBeCloseTo(3, 3);

    const moved = compareSessions(s1, {
      ...s2,
      answers: s2.answers.map((a) => ({ ...a, color: answerFromOklch([0.6, 0.1, 20]) })),
    });
    expect(moved.between!).toBeGreaterThan(30);

    expect(retestDue(s1, new Date('2026-10-02T10:01:00Z'))).toBe(false);
    expect(retestDue(s1, new Date('2026-10-03T10:02:00Z'))).toBe(true);
    const ics = reminderIcs(new Date('2026-10-06T00:00:00'), 'https://example.org');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20261006T190000');
  });
});

describe('guide reflections', () => {
  it('only describes the user\'s own color and word', async () => {
    const { reflect } = await import('../../src/screens/Guide');
    expect(reflect('Bright', [0.8, 0.1, 90])).toMatch(/agree: both are on the light side/);
    expect(reflect('Dark', [0.8, 0.1, 90])).toMatch(/lighter than your word/);
    expect(reflect('Cool', [0.6, 0.12, 230])).toMatch(/cool side/);
    expect(reflect('Sharp', [0.6, 0.12, 230])).toMatch(/all yours/);
  });
});
