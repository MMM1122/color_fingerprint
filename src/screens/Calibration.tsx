import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_REPLAYS, STIMULI, STIMULUS_DURATION_MS } from '../config/stimuli';
import { useApp } from '../store/app';
import { playStimulus, prepareStimuli, stopStimulus } from '../audio/engine';
import { answerFromOklch } from '../science/color';
import type { Answer, Oklch } from '../types';
import ColorPicker from './ColorPicker';

const byId = new Map(STIMULI.map((s) => [s.id, s]));

/**
 * Each trial starts the picker at a random hue (never the user's earlier answer), so no hue is
 * favored and nothing carries over between repetitions. The user must touch the picker or choose
 * "No color comes to mind" before moving on.
 */
function startColor(): Oklch {
  return [0.65, 0.1, Math.floor(Math.random() * 360)];
}

export default function Calibration() {
  const { progress, recordAnswer, finishCalibration, go } = useApp();
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [color, setColor] = useState<Oklch>(startColor);
  const [touched, setTouched] = useState(false);
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const firstPlayAt = useRef<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const index = progress?.index ?? 0;
  const total = progress?.order.length ?? 45;
  const trial = progress?.order[index];
  const stimulus = trial ? byId.get(trial.stimulusId) : undefined;

  useEffect(() => {
    let alive = true;
    prepareStimuli().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (progress && progress.index >= progress.order.length) finishCalibration();
  }, [progress, finishCalibration]);

  const playToken = useRef(0);
  const play = useCallback(
    async (auto = false) => {
      if (!stimulus || (playing && !auto)) return;
      const token = ++playToken.current;
      setPlaying(true);
      if (firstPlayAt.current == null) firstPlayAt.current = performance.now();
      setPlays((p) => p + 1);
      try {
        await playStimulus(stimulus);
      } finally {
        if (playToken.current === token) setPlaying(false);
      }
    },
    [stimulus, playing],
  );

  useEffect(() => () => stopStimulus(), []);

  // New trial: reset the picker and auto-play once.
  useEffect(() => {
    if (!ready || paused || !stimulus) return;
    setColor(startColor());
    setTouched(false);
    setPlays(0);
    firstPlayAt.current = null;
    headingRef.current?.focus();
    const t = setTimeout(() => play(true), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, paused, index]);

  function submit(noColor: boolean) {
    if (!trial) return;
    const rt = firstPlayAt.current == null ? 0 : performance.now() - firstPlayAt.current;
    const answer: Answer = {
      stimulusId: trial.stimulusId,
      repetition: trial.repetition,
      color: noColor ? null : answerFromOklch(color),
      reactionMs: Math.round(rt),
      replays: Math.max(0, plays - 1),
      timestamp: new Date().toISOString(),
    };
    stopStimulus();
    recordAnswer(answer, rt);
  }

  if (!progress || !trial || !stimulus) return null;

  const done = index;
  const avgMs = done > 0 ? progress.activeMs / done : 6000;
  const leftMin = Math.max(1, Math.round(((total - done) * (avgMs + STIMULUS_DURATION_MS)) / 60000));
  const replaysLeft = MAX_REPLAYS - Math.max(0, plays - 1);

  if (!ready) {
    return (
      <div className="calibration">
        <div className="page">
          <p role="status">Preparing the sounds…</p>
        </div>
      </div>
    );
  }

  if (paused) {
    return (
      <div className="calibration">
        <div className="page stack">
          <h1 style={{ fontSize: 'var(--t-xl)' }}>Paused</h1>
          <p>Your answers so far are saved on this device. You can close the page and come back later.</p>
          <div className="row">
            <button className="primary" onClick={() => setPaused(false)} autoFocus>
              Resume
            </button>
            <button onClick={() => go('landing')}>Leave for now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="calibration">
      <div className="page stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            Sound {done + 1} of {total}. About {leftMin} {leftMin === 1 ? 'minute' : 'minutes'} left.
          </span>
          <button className="link" style={{ color: '#fff' }} onClick={() => (stopStimulus(), setPaused(true))}>
            Pause
          </button>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div style={{ width: `${(done / total) * 100}%` }} />
        </div>

        <div className="trial" data-stimulus={stimulus.id}>
          <div className="listen">
            <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: 'var(--t-lg)', outline: 'none' }}>
              What color is this sound?
            </h1>
            <button className="play" onClick={() => play()} disabled={playing || replaysLeft <= 0} aria-pressed={playing}>
              {playing ? 'Playing' : 'Play again'}
            </button>
            <span>{replaysLeft > 0 ? `${replaysLeft} replay${replaysLeft === 1 ? '' : 's'} left` : 'No replays left'}</span>
            <p>Go with your first instinct. There are no wrong answers.</p>
          </div>

          <div className="stack">
            <div
              onPointerDown={() => setTouched(true)}
              onKeyDown={() => setTouched(true)}
              onInput={() => setTouched(true)}
            >
              <ColorPicker value={color} onChange={(v) => (setColor(v), setTouched(true))} />
            </div>
            <div className="row">
              <button className="primary" disabled={!touched || plays === 0} onClick={() => submit(false)}>
                Next
              </button>
              <button onClick={() => submit(true)} disabled={plays === 0}>
                No color comes to mind
              </button>
            </div>
            {!touched && plays > 0 && <p style={{ margin: 0 }}>Pick a color to continue.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
