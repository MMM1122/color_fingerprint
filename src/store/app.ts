/** App state (Zustand). Calibration progress is persisted after every answer so it survives a reload. */
import { create } from 'zustand';
import { REPETITIONS, STIMULI } from '../config/stimuli';
import { generateTrialOrder, type Trial } from '../science/trials';
import { buildFingerprint } from '../science/scoring';
import type { Answer, Fingerprint } from '../types';
import type { Account } from '../storage/cloud';
import { rebuild } from '../storage/merge';
import { load, loadFingerprint, remove, save, saveFingerprint } from '../storage/local';

export type Screen = 'landing' | 'setup' | 'calibration' | 'results' | 'immersive' | 'share' | 'account' | 'learn' | 'about';

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

export type SyncState =
  | { status: 'off' } // not signed in, or accounts not set up on this site
  | { status: 'syncing' }
  | { status: 'synced'; at: number }
  | { status: 'error'; message: string };

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
  /** Signed-in account, or null. */
  account: Account | null;
  sync: SyncState;
  /** True after a password-reset link: the account screen asks for a new password. */
  passwordRecovery: boolean;
  setAccount(a: Account | null): void;
  setSync(s: SyncState): void;
  setPasswordRecovery(v: boolean): void;
  /** Forget this device's copy (after signing out); the account keeps its copy. */
  clearLocal(): void;
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
  fingerprint: rebuild(loadFingerprint()),

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
  account: null,
  sync: { status: 'off' },
  passwordRecovery: false,
  setAccount: (account) => set({ account, sync: account ? get().sync : { status: 'off' } }),
  setSync: (sync) => set({ sync }),
  setPasswordRecovery: (passwordRecovery) => set({ passwordRecovery }),
  clearLocal: () => {
    remove('fingerprint');
    remove('progress');
    set({ fingerprint: null, progress: null });
  },
}));
