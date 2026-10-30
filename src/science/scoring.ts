/** Consistency scoring and pattern detection (spec section 3). */
import {
  CONSISTENCY_BANDS,
  NULL_RELIABILITY_FRACTION,
  PATTERN_RULES,
  RESEARCH_REFERENCE,
  TIMBRES,
} from '../config/stimuli';
import type { Answer, Fingerprint, Oklch, Session, Stimulus, Timbre } from '../types';
import { deltaELuv, hexToRgb01, hueDelta, meanOklch } from './color';
import { buildAnchors } from '../mapping/personalMap';

export type Band = 'veryClose' | 'fairlyClose' | 'quiteDifferent';

export const BAND_TEXT: Record<Band, string> = {
  veryClose: 'very close',
  fairlyClose: 'fairly close',
  quiteDifferent: 'quite different',
};

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

/** Mean pairwise ΔE (CIELUV) among a stimulus's color answers. null if fewer than 2 colors. */
export function stimulusConsistency(answers: Answer[]): number | null {
  const luvs = answers.filter((a) => a.color).map((a) => a.color!.luv);
  if (luvs.length < 2) return null;
  const ds = pairs(luvs).map(([a, b]) => deltaELuv(a, b));
  return ds.reduce((s, d) => s + d, 0) / ds.length;
}

/**
 * Eagleman et al. (2007)-style score for context: sum of city-block RGB(0-1) distances over the
 * three pairs, only for stimuli with all three colors.
 */
export function eaglemanStimulusScore(answers: Answer[]): number | null {
  const rgbs = answers.filter((a) => a.color).map((a) => hexToRgb01(a.color!.hex));
  if (rgbs.length < 3) return null;
  return pairs(rgbs).reduce(
    (s, [a, b]) => s + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]),
    0,
  );
}

export type ConsistencyResult = {
  overall: number | null;
  perStimulus: Record<string, number | null>;
  /** Overall on the literature's "sum of three pairs" scale (= mean × 3), comparable to 135. */
  overallLuvSum: number | null;
  eaglemanRgb: number | null;
  nullFraction: number;
  lowReliability: boolean;
  scoredStimuli: number;
};

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

export function groupByStimulus(answers: Answer[]): Map<string, Answer[]> {
  const m = new Map<string, Answer[]>();
  for (const a of answers) {
    if (!m.has(a.stimulusId)) m.set(a.stimulusId, []);
    m.get(a.stimulusId)!.push(a);
  }
  return m;
}

export function scoreConsistency(answers: Answer[]): ConsistencyResult {
  const groups = groupByStimulus(answers);
  const perStimulus: Record<string, number | null> = {};
  const eag: number[] = [];
  for (const [id, as] of groups) {
    perStimulus[id] = stimulusConsistency(as);
    const e = eaglemanStimulusScore(as);
    if (e != null) eag.push(e);
  }
  const scored = Object.values(perStimulus).filter((v): v is number => v != null);
  const overall = mean(scored);
  const nullFraction = answers.length ? answers.filter((a) => !a.color).length / answers.length : 0;
  return {
    overall,
    perStimulus,
    overallLuvSum: overall == null ? null : overall * 3,
    eaglemanRgb: mean(eag),
    nullFraction,
    lowReliability: nullFraction > NULL_RELIABILITY_FRACTION,
    scoredStimuli: scored.length,
  };
}

export function consistencyBand(overall: number): Band {
  if (overall < CONSISTENCY_BANDS.veryClose) return 'veryClose';
  if (overall < CONSISTENCY_BANDS.fairlyClose) return 'fairlyClose';
  return 'quiteDifferent';
}

/** Average ranks (ties share the mean rank). */
export function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx)!;
  const my = mean(ry)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Mean OKLCH color of each stimulus's answers. */
export function stimulusMeans(answers: Answer[]): Map<string, Oklch> {
  const out = new Map<string, Oklch>();
  for (const [id, as] of groupByStimulus(answers)) {
    const m = meanOklch(as.filter((a) => a.color).map((a) => a.color!.oklch));
    if (m) out.set(id, m);
  }
  return out;
}

export type PatternResult = {
  pitchLightnessRho: number | null;
  timbreHueGaps: Record<string, number>;
  timbreMeans: Partial<Record<Timbre, Oklch>>;
  pitchLightness: boolean;
  timbreHue: { a: Timbre; b: Timbre; gap: number }[];
  strongMapping: boolean;
  none: boolean;
};

export function detectPatterns(
  answers: Answer[],
  stimuli: Stimulus[],
  overall: number | null,
): PatternResult {
  const byId = new Map(stimuli.map((s) => [s.id, s]));
  const means = stimulusMeans(answers);

  // Pitch → lightness, across all stimuli that have a mean color.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [id, m] of means) {
    const s = byId.get(id);
    if (!s) continue;
    xs.push(s.midi);
    ys.push(m[0]);
  }
  const rho = spearman(xs, ys);

  // Timbre → hue: mean color per timbre over all its answers.
  const timbreMeans: Partial<Record<Timbre, Oklch>> = {};
  for (const t of TIMBRES) {
    const cols = answers
      .filter((a) => a.color && byId.get(a.stimulusId)?.timbre === t)
      .map((a) => a.color!.oklch);
    const m = meanOklch(cols);
    if (m) timbreMeans[t] = m;
  }
  const timbreHueGaps: Record<string, number> = {};
  const timbreHue: PatternResult['timbreHue'] = [];
  for (const [a, b] of pairs([...TIMBRES])) {
    const ma = timbreMeans[a];
    const mb = timbreMeans[b];
    if (!ma || !mb) continue;
    if (ma[1] < PATTERN_RULES.timbreHueMinChroma || mb[1] < PATTERN_RULES.timbreHueMinChroma) continue;
    const gap = Math.abs(hueDelta(ma[2], mb[2]));
    timbreHueGaps[`${a}|${b}`] = Math.round(gap * 10) / 10;
    if (gap > PATTERN_RULES.timbreHueMinGapDeg) timbreHue.push({ a, b, gap });
  }
  timbreHue.sort((p, q) => q.gap - p.gap);

  const pitchLightness = rho != null && rho >= PATTERN_RULES.pitchLightnessMinRho;
  const strongMapping = overall != null && overall < RESEARCH_REFERENCE.rothenLuvMeanCutoff;
  return {
    pitchLightnessRho: rho,
    timbreHueGaps,
    timbreMeans,
    pitchLightness,
    timbreHue,
    strongMapping,
    none: !pitchLightness && timbreHue.length === 0 && !strongMapping,
  };
}

/** Build the saved Fingerprint from a finished session (plus any earlier sessions). */
export function buildFingerprint(
  sessions: Session[],
  stimuli: Stimulus[],
  flags: Fingerprint['flags'],
  createdAt = new Date().toISOString(),
): Fingerprint {
  // Consistency and patterns describe the latest session (the spec's within-session measure).
  // The personal map uses every session's answers, so retests make it more accurate.
  const latest = sessions[sessions.length - 1]?.answers ?? [];
  const c = scoreConsistency(latest);
  const p = detectPatterns(latest, stimuli, c.overall);
  return {
    schemaVersion: 1,
    createdAt,
    sessions,
    anchors: buildAnchors(sessions.flatMap((s) => s.answers), stimuli),
    consistency: { overall: c.overall, perStimulus: c.perStimulus },
    patterns: { pitchLightnessRho: p.pitchLightnessRho, timbreHueGaps: p.timbreHueGaps },
    flags,
  };
}
