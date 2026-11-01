import { describe, expect, it } from 'vitest';
import { STIMULI } from '../../src/config/stimuli';
import { answerFromOklch } from '../../src/science/color';
import { buildFingerprint } from '../../src/science/scoring';
import { mergeFingerprints, mergeSessions, sameSessions } from '../../src/storage/merge';
import type { Session } from '../../src/types';
import { ans } from './helpers';

const session = (startedAt: string, hue: number, n = 6): Session => ({
  startedAt,
  answers: STIMULI.slice(0, n / 3).flatMap((s) =>
    ([1, 2, 3] as const).map((r) => ({ ...ans(s.id, r, answerFromOklch([0.6, 0.1, hue])), timestamp: startedAt })),
  ),
});

describe('merging device and account fingerprints', () => {
  it('keeps every distinct session, oldest first, without duplicates', () => {
    const a = session('2026-10-01T10:00:00Z', 200);
    const b = session('2026-10-05T10:00:00Z', 30);
    const merged = mergeSessions([b, a], [a]);
    expect(merged.map((s) => s.startedAt)).toEqual([a.startedAt, b.startedAt]);
  });

  it('keeps the more complete copy of the same session', () => {
    const short = session('2026-10-01T10:00:00Z', 200, 3);
    const full = { ...short, answers: session('2026-10-01T10:00:00Z', 200, 6).answers };
    // Different answer counts → different keys; both kept (they are different saves)…
    expect(mergeSessions([short], [full])).toHaveLength(2);
    // …but an identical session from both sides appears once.
    expect(mergeSessions([full], [full])).toHaveLength(1);
  });

  it('rebuilds scores and the personal map from the merged sessions', () => {
    const local = buildFingerprint([session('2026-10-05T10:00:00Z', 30)], STIMULI, { colorVisionDifference: true });
    const remote = buildFingerprint([session('2026-10-01T10:00:00Z', 200)], STIMULI, {});
    const m = mergeFingerprints(local, remote)!;
    expect(m.sessions).toHaveLength(2);
    expect(m.sessions[1].startedAt).toBe('2026-10-05T10:00:00Z'); // latest drives consistency
    expect(m.flags.colorVisionDifference).toBe(true);
    expect(m.createdAt).toBe(remote.createdAt < local.createdAt ? remote.createdAt : local.createdAt);
    expect(m.anchors.piano[48]).not.toBeNull();
  });

  it('handles one side missing', () => {
    const fp = buildFingerprint([session('2026-10-01T10:00:00Z', 200)], STIMULI, {});
    expect(mergeFingerprints(null, fp)).toBe(fp);
    expect(mergeFingerprints(fp, null)).toBe(fp);
    expect(mergeFingerprints(null, null)).toBeNull();
    expect(sameSessions(fp, mergeFingerprints(fp, fp))).toBe(true);
  });
});
