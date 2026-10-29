import { useEffect, useRef, useState } from 'react';
import type * as Tone from 'tone';
import { ANALYSIS, STIMULI, TIMBRE_LABELS, midiToName } from '../config/stimuli';
import { useApp } from '../store/app';
import {
  decodeFile,
  isPlaying,
  pauseSource,
  playSource,
  prepareStimuli,
  readFrame,
  resumeSource,
  sampleRate,
  stimulusArray,
  stopSource,
  trackBuffer,
} from '../audio/engine';
import { LiveMapper, referencesFromBuffers, renderStimulus } from '../audio/pipeline';
import type { TimbreReferences } from '../audio/timbreMatch';
import { topTimbre } from '../audio/timbreMatch';
import { TRACKS, type TrackId } from '../audio/tracks';
import { makeDefaultMap, makePersonalMap } from '../mapping/personalMap';
import { ParticleField } from '../visuals/particles';
import { AssociatorScene } from '../visuals/scene';

/** The warning shows every time immersive mode starts from a cold page load. */
let warnedThisLoad = false;
let cachedRefs: TimbreReferences | null = null;

async function getReferences(): Promise<TimbreReferences> {
  if (cachedRefs) return cachedRefs;
  await prepareStimuli();
  const sr = sampleRate();
  cachedRefs = referencesFromBuffers(
    STIMULI.map((s) => ({ stimulus: s, buffer: stimulusArray(s.id) ?? renderStimulus(s, sr) })),
    sr,
  );
  return cachedRefs;
}

export default function Immersive() {
  const [warned, setWarned] = useState(warnedThisLoad);
  if (!warned) return <Warning onContinue={() => ((warnedThisLoad = true), setWarned(true))} />;
  return <Visualizer />;
}

function Warning({ onContinue }: { onContinue(): void }) {
  const { prefs, setPrefs, go } = useApp();
  // Start generating the first track and the timbre references while the warning is read.
  useEffect(() => {
    trackBuffer('rain').catch(() => undefined);
    getReferences().catch(() => undefined);
  }, []);
  return (
    <div className="warning">
      <div className="page stack">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>Moving light ahead</h1>
        <p>
          The visualizer fills the screen with moving color. Brightness changes are limited to stay below
          flashing thresholds, but if you are sensitive to light, take care or turn on reduced motion.
        </p>
        <label className="check">
          <input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => setPrefs({ reducedMotion: e.target.checked })} />
          <span>Reduce motion: slower drifting, no sudden shapes.</span>
        </label>
        <div className="row">
          <button className="primary" autoFocus onClick={onContinue}>Start the visualizer</button>
          <button onClick={() => go('results')}>Back to my colors</button>
        </div>
      </div>
    </div>
  );
}

type Source = TrackId | 'file';

function Visualizer() {
  const { fingerprint, prefs, go } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('Preparing…');
  const [source, setSource] = useState<Source>('rain');
  const [fileName, setFileName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [intensity, setIntensity] = useState(0.8);
  const [usePersonal, setUsePersonal] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [readout, setReadout] = useState('');
  const [fps, setFps] = useState<number | null>(null);
  const showFps = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps');

  const live = useRef<{ mapper: LiveMapper; field: ParticleField; scene: AssociatorScene } | null>(null);
  const fileBuffer = useRef<Tone.ToneAudioBuffer | null>(null);

  // Build the pipeline and run the render loop.
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let onResize: (() => void) | null = null;
    const frame = new Float32Array(ANALYSIS.frameSize);
    (async () => {
      const refs = await getReferences();
      if (disposed) return;
      const map = fingerprint ? makePersonalMap(fingerprint.anchors) : makeDefaultMap();
      const scene = new AssociatorScene(canvasRef.current!, 320);
      const field = new ParticleField({ reducedMotion: prefs.reducedMotion, intensity, aspect: scene.aspect });
      const mapper = new LiveMapper(sampleRate(), refs, map);
      live.current = { mapper, field, scene };
      onResize = () => {
        scene.resize();
        field.opts.aspect = scene.aspect;
      };
      window.addEventListener('resize', onResize);
      let last = performance.now();
      let frames = 0;
      let fpsT = last;
      let readoutT = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        readFrame(frame);
        const s = mapper.step(frame, now, dt * 1000);
        field.update(
          {
            color: s.color,
            midi: s.midi,
            rms: s.features.rms,
            onset: s.features.onset,
            flatness: s.features.flatness,
            silent: s.features.silent || !isPlaying(),
          },
          dt,
          now / 1000,
        );
        scene.render(field, now / 1000, field.opts.reducedMotion);
        if (now - readoutT > 400) {
          readoutT = now;
          setReadout(
            s.features.silent || s.midi == null
              ? 'Listening…'
              : `Closest to ${TIMBRE_LABELS[topTimbre(s.weights)].toLowerCase()}, around ${midiToName(s.midi)}`,
          );
        }
        frames++;
        if (now - fpsT > 1000) {
          setFps(Math.round((frames * 1000) / (now - fpsT)));
          frames = 0;
          fpsT = now;
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      setStatus('');
      await start('rain');
    })();
    return () => {
      disposed = true;
      if (onResize) window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      stopSource();
      live.current?.scene.dispose();
      live.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live settings.
  useEffect(() => {
    if (live.current) live.current.field.opts.intensity = intensity;
  }, [intensity]);
  useEffect(() => {
    live.current?.field.setReducedMotion(prefs.reducedMotion);
  }, [prefs.reducedMotion]);
  useEffect(() => {
    if (live.current && fingerprint) {
      live.current.mapper.map = usePersonal ? makePersonalMap(fingerprint.anchors) : makeDefaultMap();
    }
  }, [usePersonal, fingerprint]);

  // Controls fade after 3 s without input, and come back on any pointer or key activity.
  useEffect(() => {
    let t = window.setTimeout(() => setControlsVisible(false), 3000);
    const wake = () => {
      setControlsVisible(true);
      clearTimeout(t);
      t = window.setTimeout(() => {
        if (!document.activeElement?.closest('.controls')) setControlsVisible(false);
      }, 3000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go('results');
      wake();
    };
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', onKey);
    };
  }, [go]);

  async function start(src: Source) {
    try {
      if (src === 'file') {
        if (!fileBuffer.current) return;
        playSource(fileBuffer.current, true);
      } else {
        setStatus('Preparing the track…');
        const buf = await trackBuffer(src);
        playSource(buf, true);
        setStatus('');
      }
      setPlaying(true);
    } catch (err) {
      setStatus(`That didn't play: ${(err as Error).message}`);
    }
  }

  function togglePlay() {
    if (isPlaying()) {
      pauseSource();
      setPlaying(false);
    } else {
      resumeSource();
      setPlaying(true);
    }
  }

  async function onFile(f: File) {
    setStatus('Opening your file…');
    try {
      fileBuffer.current = await decodeFile(f);
      setFileName(f.name);
      setSource('file');
      setStatus('');
      await start('file');
    } catch {
      setStatus("That file couldn't be opened. Try an MP3, WAV, OGG or M4A file.");
    }
  }

  return (
    <div className="immersive">
      <h1 className="visually-hidden">Music in your colors</h1>
      <canvas ref={canvasRef} aria-label="Music visualization in your colors" role="img" />
      <div className={`status${controlsVisible || status ? '' : ' hidden'}`} aria-live="polite">
        {status || readout}
        {showFps && fps != null && <span> ({fps} fps)</span>}
      </div>
      <div
        className={`controls${controlsVisible ? '' : ' hidden'}`}
        onFocus={() => setControlsVisible(true)}
        role="toolbar"
        aria-label="Visualizer controls"
      >
        <button onClick={togglePlay} aria-pressed={playing}>{playing ? 'Pause' : 'Play'}</button>
        <label>
          <span className="visually-hidden">Music</span>
          <select
            value={source}
            onChange={(e) => {
              const v = e.target.value as Source | 'upload';
              if (v === 'upload') {
                fileRef.current?.click();
                return;
              }
              setSource(v);
              start(v);
            }}
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
            {fileName && <option value="file">{fileName}</option>}
            <option value="upload">Open a file from your device…</option>
          </select>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
        <label>
          Intensity
          <input type="range" min={0.2} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
        </label>
        <label>
          <span className="visually-hidden">View</span>
          <select value="associator" onChange={() => undefined} aria-describedby="view-note">
            <option value="associator">Mind's eye view</option>
            <option value="projector" disabled>Camera view (coming later)</option>
          </select>
        </label>
        {fingerprint && (
          <div className="toggle" role="group" aria-label="Color mapping">
            <button aria-pressed={usePersonal} onClick={() => setUsePersonal(true)}>Your colors</button>
            <button aria-pressed={!usePersonal} onClick={() => setUsePersonal(false)}>Default colors</button>
          </div>
        )}
        <button onClick={() => go('results')}>Exit</button>
      </div>
      <span id="view-note" className="visually-hidden">The camera view arrives in a later version.</span>
    </div>
  );
}
