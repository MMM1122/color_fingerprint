import { describe, expect, it } from 'vitest';
import { STIMULI, TARGET_LOUDNESS_LUFS, midiToName } from '../../src/config/stimuli';
import { FeatureExtractor } from '../../src/audio/features';
import { measureLoudness } from '../../src/audio/loudness';
import { defaultReferences, frames, LiveMapper, renderStimulus } from '../../src/audio/pipeline';
import { softmaxWeights, timbreDistances, timbreVector, topTimbre } from '../../src/audio/timbreMatch';
import { buildAnchors, makePersonalMap } from '../../src/mapping/personalMap';
import { answerFromOklch, deltaEOklch } from '../../src/science/color';
import type { Timbre } from '../../src/types';
import { ans } from './helpers';

const SR = 44100;

function sine(hz: number, seconds: number, sr = SR) {
  const b = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < b.length; i++) b[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / sr);
  return b;
}

describe('pitch detection', () => {
  for (const [hz, name] of [[220, 'A3'], [440, 'A4'], [880, 'A5']] as const) {
    it(`detects ${hz} Hz as ${name}`, () => {
      const fx = new FeatureExtractor(SR);
      const buf = sine(hz, 0.2);
      const f = fx.analyze(buf.subarray(0, 2048), 0);
      expect(f.pitched).toBe(true);
      expect(midiToName(f.midi!)).toBe(name);
    });
  }
});

describe('stimuli', () => {
  it('are normalized to the same loudness', () => {
    for (const s of STIMULI) {
      expect(measureLoudness(renderStimulus(s, SR), SR)).toBeCloseTo(TARGET_LOUDNESS_LUFS, 0);
    }
  });
});

describe('timbre matching', () => {
  const refs = defaultReferences(SR);

  it('each calibration sample, played back, gets its own timbre as the top weight', () => {
    for (const s of STIMULI) {
      const buf = renderStimulus(s, SR);
      const fx = new FeatureExtractor(SR);
      const sums: Record<Timbre, number> = { piano: 0, sine: 0, strings: 0 };
      for (const { frame, start } of frames(buf)) {
        const f = fx.analyze(frame, (start / SR) * 1000);
        const v = timbreVector(f);
        if (!v || f.midi == null) continue;
        const w = softmaxWeights(timbreDistances(v, refs, f.midi));
        (Object.keys(sums) as Timbre[]).forEach((t) => (sums[t] += w[t]));
      }
      expect(topTimbre(sums), s.id).toBe(s.timbre);
    }
  });

  it('a pure A4 sine through the pipeline shows the user\'s sine color at A4 (ΔE < 5)', () => {
    // A user whose timbres have clearly different colors, with lightness rising by pitch.
    const answers = STIMULI.flatMap((s) => {
      const hue = s.timbre === 'piano' ? 250 : s.timbre === 'sine' ? 140 : 30;
      const c = answerFromOklch([0.35 + ((s.midi - 48) / 35) * 0.5, 0.11, hue]);
      return ([1, 2, 3] as const).map((r) => ans(s.id, r, c));
    });
    const map = makePersonalMap(buildAnchors(answers, STIMULI));
    const live = new LiveMapper(SR, refs, map);
    const buf = sine(440, 2);
    const dt = (512 / SR) * 1000;
    let last = null;
    for (const { frame, start } of frames(buf)) last = live.step(frame, (start / SR) * 1000, dt);
    const expected = map.colorFor('sine', 69);
    const de = deltaEOklch(last!.color!, expected);
    expect(de).toBeLessThan(5);
  });
});

describe('timbre matching on the built-in tracks (approximate)', () => {
  it('the piano track is labelled "closest to piano" more often than anything else', async () => {
    const { renderTrack } = await import('../../src/audio/tracks');
    const refs = defaultReferences(SR);
    const buf = renderTrack('rain', SR);
    const fx = new FeatureExtractor(SR);
    const counts: Record<Timbre, number> = { piano: 0, sine: 0, strings: 0 };
    for (const { frame, start } of frames(buf, 2048, 2048)) {
      const f = fx.analyze(frame, (start / SR) * 1000);
      const v = timbreVector(f);
      if (!v || f.midi == null) continue;
      counts[topTimbre(softmaxWeights(timbreDistances(v, refs, f.midi)))]++;
    }
    expect(topTimbre(counts)).toBe('piano');
  }, 30_000);
});
