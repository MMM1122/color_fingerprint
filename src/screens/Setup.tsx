import { useState } from 'react';
import { useApp } from '../store/app';
import { getVolume, openSoundGate, playTestTone, setVolume, unlockAudio } from '../audio/engine';
import TopBar from './TopBar';

/** Setup and safety. Nothing makes a sound until both confirmations are ticked. */
export default function Setup() {
  const { prefs, setPrefs, completeSetup, startCalibration, go, fingerprint, progress } = useApp();
  const [headphones, setHeadphones] = useState(false);
  const [notice, setNotice] = useState(false);
  const [vol, setVol] = useState(getVolume());
  const [heardTone, setHeardTone] = useState(false);
  const [playing, setPlaying] = useState(false);
  const confirmed = headphones && notice;

  async function testTone() {
    openSoundGate();
    await unlockAudio();
    setPlaying(true);
    try {
      await playTestTone();
    } finally {
      setPlaying(false);
      setHeardTone(true);
    }
  }

  async function begin(target: 'calibration' | 'immersive') {
    openSoundGate();
    await unlockAudio();
    completeSetup();
    if (target === 'calibration') startCalibration();
    go(target);
  }

  return (
    <>
      <TopBar />
      <div className="page stack">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>Before you start</h1>
        <p>Put on headphones and set a comfortable volume. Some visuals move quickly; you can slow them down anytime.</p>

        <fieldset className="stack panel">
          <legend>Sound and light</legend>
          <label className="check">
            <input type="checkbox" checked={headphones} onChange={(e) => setHeadphones(e.target.checked)} />
            <span>I'm wearing headphones, or I'm somewhere quiet with the volume low.</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={notice} onChange={(e) => setNotice(e.target.checked)} />
            <span>
              I understand the music visuals use moving light and color. They are limited to slow changes, but if
              you are sensitive to flashing light, please take care.
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.reducedMotion}
              onChange={(e) => setPrefs({ reducedMotion: e.target.checked })}
            />
            <span>Reduce motion: slower drifting, no sudden shapes.</span>
          </label>
        </fieldset>

        <fieldset className="stack panel" disabled={!confirmed}>
          <legend>Volume check</legend>
          <div className="slider-row" style={{ gridTemplateColumns: '5.5rem minmax(0,1fr) auto', ['--track' as string]: 'linear-gradient(90deg,#444,#ddd)' }}>
            <label htmlFor="vol">Volume</label>
            <input
              id="vol"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={vol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVol(v);
                setVolume(v);
              }}
            />
            <output htmlFor="vol">{Math.round(vol * 100)}%</output>
          </div>
          <div className="row">
            <button onClick={testTone} disabled={!confirmed || playing} aria-pressed={playing}>
              {playing ? 'Playing…' : heardTone ? 'Play test tone again' : 'Play test tone'}
            </button>
            {!confirmed && <span className="quiet">Tick the first two boxes to hear the test tone.</span>}
          </div>
        </fieldset>

        <fieldset className="stack panel">
          <legend>Do you have a color vision difference? (optional)</legend>
          <p className="quiet">We only use this to add a note to your results.</p>
          <div className="row" role="radiogroup" aria-label="Color vision difference">
            {([['Yes', true], ['No', false], ['Prefer not to say', undefined]] as const).map(([label, value]) => (
              <label key={label} className="check" style={{ alignItems: 'center' }}>
                <input
                  type="radio"
                  name="cvd"
                  checked={prefs.colorVisionDifference === value}
                  onChange={() => setPrefs({ colorVisionDifference: value })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="panel stack">
          <p className="quiet">This is a playful experiment, not a medical or diagnostic test.</p>
          <div className="row">
            <button className="primary" disabled={!confirmed || !heardTone} onClick={() => begin('calibration')}>
              {progress?.retest ? 'Start the retest' : progress && progress.index > 0 ? 'Continue listening' : 'Start listening'}
            </button>
            {fingerprint && (
              <button disabled={!confirmed || !heardTone} onClick={() => begin('immersive')}>
                Hear music in your colors
              </button>
            )}
          </div>
          {confirmed && !heardTone && <p className="quiet">Play the test tone once so you know the volume is comfortable.</p>}
        </div>
      </div>
    </>
  );
}
