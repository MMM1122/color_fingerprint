/**
 * Retest comparison (Phase 2): how a new session compares with the previous one.
 *
 *  - before / after: within-session consistency (spec's mean pairwise ΔE, CIELUV) for each session.
 *  - between: for each sound answered with a color in both sessions, the ΔE between the session's
 *    average colors, averaged over sounds. This is a test–retest measure; lower = steadier.
 *
 * The bands for "between" reuse the consistency bands. That is a design choice for plain-language
 * copy, not a published threshold.
 */
import { RETEST_MIN_DAYS } from '../config/stimuli';
import type { Answer, Session } from '../types';
import { deltaEOklch } from './color';
import { scoreConsistency, stimulusMeans } from './scoring';

export type RetestComparison = {
  before: number | null;
  after: number | null;
  between: number | null;
  compared: number;
  daysApart: number;
};

export function sessionEnd(s: Session): Date {
  const last = s.answers[s.answers.length - 1]?.timestamp ?? s.startedAt;
  return new Date(last);
}

export function compareSessions(prev: Session, latest: Session): RetestComparison {
  const a = stimulusMeans(prev.answers);
  const b = stimulusMeans(latest.answers);
  const ds: number[] = [];
  for (const [id, m] of a) {
    const n = b.get(id);
    if (n) ds.push(deltaEOklch(m, n));
  }
  const days = (sessionEnd(latest).getTime() - sessionEnd(prev).getTime()) / 86_400_000;
  return {
    before: scoreConsistency(prev.answers).overall,
    after: scoreConsistency(latest.answers).overall,
    between: ds.length ? ds.reduce((s, d) => s + d, 0) / ds.length : null,
    compared: ds.length,
    daysApart: Math.max(0, days),
  };
}

/** All answers across sessions, for building the personal map from as much data as possible. */
export function allAnswers(sessions: Session[]): Answer[] {
  return sessions.flatMap((s) => s.answers);
}

export function daysSince(session: Session, now = new Date()): number {
  return (now.getTime() - sessionEnd(session).getTime()) / 86_400_000;
}

export function retestDue(session: Session, now = new Date()): boolean {
  return daysSince(session, now) >= RETEST_MIN_DAYS;
}

/** An all-day-agnostic calendar reminder (.ics) for a retest, 7 pm local time on the due day. */
export function reminderIcs(due: Date, url: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const start = new Date(due);
  start.setHours(19, 0, 0, 0);
  const end = new Date(start.getTime() + 15 * 60_000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Color Fingerprint//Retest reminder//EN',
    'BEGIN:VEVENT',
    `UID:retest-${start.getTime()}@color-fingerprint`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(start)}`,
    `DTEND:${local(end)}`,
    'SUMMARY:Retest your Color Fingerprint',
    `DESCRIPTION:Take the sound-to-color test again to see how steady your colors are. ${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
