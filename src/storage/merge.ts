/**
 * Merging a fingerprint saved on this device with the one saved in the account.
 * Sessions are the source of truth: everything else (anchors, scores, patterns) is rebuilt from them.
 * Pure, so it is unit-tested.
 */
import { STIMULI } from '../config/stimuli';
import { buildFingerprint } from '../science/scoring';
import type { Fingerprint, Session } from '../types';

const sessionKey = (s: Session) => `${s.startedAt}|${s.answers.length}`;

/** Union of both sets of sessions (no duplicates), oldest first. */
export function mergeSessions(a: Session[], b: Session[]): Session[] {
  const byKey = new Map<string, Session>();
  for (const s of [...a, ...b]) {
    const k = sessionKey(s);
    const existing = byKey.get(k);
    // If the same session exists twice, keep the copy with more answers.
    if (!existing || s.answers.length > existing.answers.length) byKey.set(k, s);
  }
  return [...byKey.values()].sort((x, y) => x.startedAt.localeCompare(y.startedAt));
}

/**
 * Recompute everything derived (palette, scores, patterns) from the saved answers, so a fingerprint
 * saved by an older version of the site picks up improvements to the math.
 */
export function rebuild(fp: Fingerprint | null): Fingerprint | null {
  if (!fp) return null;
  try {
    return buildFingerprint(fp.sessions, STIMULI, fp.flags ?? {}, fp.createdAt);
  } catch {
    return fp;
  }
}

export function mergeFingerprints(local: Fingerprint | null, remote: Fingerprint | null): Fingerprint | null {
  if (!local) return rebuild(remote);
  if (!remote) return rebuild(local);
  const sessions = mergeSessions(local.sessions, remote.sessions);
  const flags = { ...remote.flags, ...local.flags };
  const createdAt = [local.createdAt, remote.createdAt].sort()[0];
  return buildFingerprint(sessions, STIMULI, flags, createdAt);
}

/** True when merging changed nothing, so no upload is needed. */
export function sameSessions(a: Fingerprint | null, b: Fingerprint | null): boolean {
  if (!a || !b) return a === b;
  const ka = a.sessions.map(sessionKey).join(',');
  const kb = b.sessions.map(sessionKey).join(',');
  return ka === kb;
}
