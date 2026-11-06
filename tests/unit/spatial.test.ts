import { describe, expect, it } from 'vitest';
import { SpatialTracker, notePanOf, panOf, sideWord } from '../../src/audio/spatial';
import { mulberry32 } from '../../src/science/trials';

const SR = 44100;
const N = 2048;
const sine = (hz: number, gain = 0.3) =>
  Float32Array.from({ length: N }, (_, i) => gain * Math.sin((2 * Math.PI * hz * i) / SR));
const silence = () => new Float32Array(N);

describe('stereo pan and width', () => {
  it('a sound only in the left channel is hard left and narrow', () => {
    const p = panOf(sine(440), silence());
    expect(p.pan).toBeCloseTo(-1, 5);
    expect(p.width).toBe(0);
  });

  it('the same sound in both channels is centred and narrow', () => {
    const s = sine(440);
    const p = panOf(s, s);
    expect(p.pan).toBeCloseTo(0, 5);
    expect(p.width).toBeCloseTo(0, 5);
  });

  it('equal-power pan law: a source panned 30% right reads as right of centre', () => {
    const theta = ((0.3 + 1) * Math.PI) / 4;
    const s = sine(440);
    const p = panOf(s.map((x) => x * Math.cos(theta)), s.map((x) => x * Math.sin(theta)));
    expect(p.pan).toBeGreaterThan(0.2);
    expect(p.pan).toBeLessThan(0.6);
  });

  it('unrelated left and right channels (like reverb) are wide', () => {
    const rng = mulberry32(5);
    const l = Float32Array.from({ length: N }, () => rng() - 0.5);
    const r = Float32Array.from({ length: N }, () => rng() - 0.5);
    expect(panOf(l, r).width).toBeGreaterThan(0.8);
  });

  it('per-note pan separates two instruments in one mix', () => {
    // Note A (220 Hz) mostly left, note B (587 Hz; not a harmonic of 220) mostly right, mixed together.
    const a = sine(220);
    const b = sine(587.33);
    const l = a.map((x, i) => 0.9 * x + 0.1 * b[i]);
    const r = a.map((x, i) => 0.1 * x + 0.9 * b[i]);
    expect(notePanOf(l, r, 220, SR)!).toBeLessThan(-0.5);
    expect(notePanOf(l, r, 587.33, SR)!).toBeGreaterThan(0.5);
  });

  it('the tracker stays inactive for mono sources and turns on for stereo ones', () => {
    const mono = new SpatialTracker(SR);
    const s = sine(440);
    let st = mono.step(s, s, 440, 16);
    for (let i = 0; i < 60; i++) st = mono.step(s, s, 440, 16);
    expect(st.active).toBe(false);

    const stereo = new SpatialTracker(SR);
    for (let i = 0; i < 60; i++) st = stereo.step(s, silence(), 440, 16);
    expect(st.active).toBe(true);
    expect(st.pan).toBeLessThan(-0.9);
  });

  it('describes the side in plain words', () => {
    expect(sideWord(-0.6)).toBe('on the left');
    expect(sideWord(0.1)).toBeNull();
    expect(sideWord(0.7)).toBe('on the right');
  });
});

describe('stereo demo tracks', () => {
  it('place instruments on different sides, and the visual spawn follows the pan', async () => {
    const { panFor, renderTrackStereo } = await import('../../src/audio/tracks');
    const { spatialX } = await import('../../src/visuals/particles');
    expect(panFor('strings', 67)).toBeGreaterThan(0.3);
    expect(panFor('sine', 76)).toBeLessThan(-0.3);
    expect(panFor('piano', 48)).toBeLessThan(panFor('piano', 84));

    const [l, r] = renderTrackStereo('bloom', SR);
    expect(l.length).toBe(r.length);
    let peak = 0;
    for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
    expect(peak).toBeLessThanOrEqual(0.89 + 1e-6);

    // Spawn positions: hard left stays left; mono uses the whole width.
    const rng = mulberry32(9);
    const xs = Array.from({ length: 500 }, () => spatialX({ pan: -1, width: 0 }, 1.5, rng(), rng()));
    expect(Math.max(...xs)).toBeLessThan(0);
    const mono = Array.from({ length: 500 }, () => spatialX(null, 1.5, rng(), rng()));
    expect(Math.min(...mono)).toBeLessThan(-1.2);
    expect(Math.max(...mono)).toBeGreaterThan(1.2);
  }, 30_000);
});
