/** Data model from spec section 5. */

/** 'voice' (a sung "ah") was added in Phase 2. */
export type Timbre = 'piano' | 'sine' | 'strings' | 'voice';

export type Stimulus = {
  id: string;
  timbre: Timbre;
  midi: number;
  file?: string;
  durationMs: number;
};

/** OKLCH as [L 0-1, C ≥0, H degrees]. */
export type Oklch = [number, number, number];
/** CIELUV as [L*, u*, v*]. */
export type Luv = [number, number, number];

export type ColorAnswer = { hex: string; luv: Luv; oklch: Oklch };

export type Answer = {
  stimulusId: string;
  repetition: 1 | 2 | 3;
  color: ColorAnswer | null;
  reactionMs: number;
  replays: number;
  timestamp: string;
};

export type Session = { startedAt: string; answers: Answer[] };

export type Fingerprint = {
  schemaVersion: 1;
  createdAt: string;
  sessions: Session[];
  anchors: Record<string /* timbre */, Record<number /* midi */, Oklch | null>>;
  consistency: { overall: number | null; perStimulus: Record<string, number | null> };
  patterns: { pitchLightnessRho: number | null; timbreHueGaps: Record<string, number> };
  flags: { colorVisionDifference?: boolean };
};
