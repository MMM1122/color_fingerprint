/** App state (Zustand). Calibration progress is persisted after every answer so it survives a reload. */
import { create } from 'zustand';
import { REPETITIONS, STIMULI } from '../config/stimuli';
import { generateTrialOrder, type Trial } from '../science/trials';
import { buildFingerprint } from '../science/scoring';
import type { Answer, Fingerprint } from '../types';
import { load, loadFingerprint, remove, save, saveFingerprint } from '../storage/local';

export type Screen = 'landing' | 'setup' | 'calibration' | 'results' | 'immersive' | 'share' | 'learn' | 'about';

export type CalibrationProgress = {
  startedAt: string;
  order: Trial[];
  index: number;
  answers: Answer[];
  /** Total ms spent answering, for the time-left estimate. */
  activeMs: number;
  /** True when this run is a retest that will be compared with the saved fingerprint. */
  retest?: boolean;
};

type Prefs = { reducedMotion: boolean; colorVisionDifference?: boolean };

type State = {
  screen: Screen;
  /** Setup confirmed this page load: sound is allowed only after this. */
  setupDone: boolean;
  prefs: Prefs;
  progress: CalibrationProgress | null;
  fingerprint: Fingerprint | null;
  go(screen: Screen): void;
  setPrefs(p: Partial<Prefs>): void;
  completeSetup(): void;
  startCalibration(): void;
  startRetest(): void;
  recordAnswer(a: Answer, ms: number): void;
  finishCalibration(): void;
  discardProgress(): void;
  setFingerprint(fp: Fingerprint): void;
};

const osReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export const useApp = create<State>((set, get) => ({
  screen: 'landing',
  setupDone: false,
  prefs: load<Prefs>('prefs') ?? { reducedMotion: osReducedMotion() },
  progress: load<CalibrationProgress>('progress'),
  fingerprint: loadFingerprint(),

  go: (screen) => {
    set({ screen });
    window.scrollTo?.(0, 0);
  },
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    save('prefs', prefs);
    set({ prefs });
  },
  completeSetup: () => set({ setupDone: true }),
  startCalibration: () => {
    const existing = get().progress;
    if (existing && existing.index < existing.order.length) return; // resume
    const progress: CalibrationProgress = {
      startedAt: new Date().toISOString(),
      order: generateTrialOrder(STIMULI, REPETITIONS),
      index: 0,
      answers: [],
      activeMs: 0,
    };
    save('progress', progress);
    set({ progress });
  },
  startRetest: () => {
    const progress: CalibrationProgress = {
      startedAt: new Date().toISOString(),
      order: generateTrialOrder(STIMULI, REPETITIONS),
      index: 0,
      answers: [],
      activeMs: 0,
      retest: true,
    };
    save('progress', progress);
    set({ progress });
  },
  recordAnswer: (a, ms) => {
    const p = get().progress;
    if (!p) return;
    const progress = { ...p, answers: [...p.answers, a], index: p.index + 1, activeMs: p.activeMs + ms };
    save('progress', progress);
    set({ progress });
  },
  finishCalibration: () => {
    const p = get().progress;
    if (!p) return;
    // A first test replaces any old fingerprint; a retest adds a session to it.
    const prev = p.retest ? (get().fingerprint?.sessions ?? []) : [];
    const fp = buildFingerprint([...prev, { startedAt: p.startedAt, answers: p.answers }], STIMULI, {
      colorVisionDifference: get().prefs.colorVisionDifference,
    });
    saveFingerprint(fp);
    remove('progress');
    set({ fingerprint: fp, progress: null, screen: 'results' });
  },
  discardProgress: () => {
    remove('progress');
    set({ progress: null });
  },
  setFingerprint: (fp) => {
    saveFingerprint(fp);
    set({ fingerprint: fp });
  },
}));
