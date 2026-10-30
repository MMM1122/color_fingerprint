/**
 * Browser audio: one AudioContext (via Tone.js), a master volume that starts low and is never
 * raised automatically, an AnalyserNode for live features, and the sources (built-in tracks,
 * uploaded files). Nothing is recorded or uploaded; uploaded files are decoded locally.
 */
import * as Tone from 'tone';
import { ANALYSIS, FADE_MS, STIMULI, TARGET_LOUDNESS_LUFS } from '../config/stimuli';
import type { Stimulus } from '../types';
import { applyFades } from './synth';
import { normalizeLoudness } from './loudness';
import { renderStimulus } from './pipeline';
import type { TrackId } from './tracks';

export const DEFAULT_VOLUME = 0.25;

let master: Tone.Gain | null = null;
let analyser: AnalyserNode | null = null;
let volume = DEFAULT_VOLUME;
const stimulusBuffers = new Map<string, Tone.ToneAudioBuffer>();
const stimulusArrays = new Map<string, Float32Array>();
const trackCache = new Map<TrackId, Tone.ToneAudioBuffer>();

/** Perceptual-ish volume curve: slider 0-1 → gain. */
const toGain = (v: number) => Math.min(1, Math.max(0, v)) ** 2;

export function audioContext(): AudioContext {
  return Tone.getContext().rawContext as AudioContext;
}

export function sampleRate(): number {
  return audioContext().sampleRate;
}

function ensureGraph() {
  if (!master) {
    master = new Tone.Gain(toGain(volume)).toDestination();
    analyser = audioContext().createAnalyser();
    analyser.fftSize = ANALYSIS.frameSize;
    analyser.smoothingTimeConstant = 0;
  }
  return { master: master!, analyser: analyser! };
}

/**
 * Sound gate: no sound of any kind until the setup screen's headphone and photosensitivity
 * confirmations are done (Phase 1 acceptance criterion).
 */
let gateOpen = false;
export function openSoundGate() {
  gateOpen = true;
}
export function soundAllowed() {
  return gateOpen;
}
function assertGate() {
  if (!gateOpen) throw new Error('Sound is blocked until setup is confirmed.');
}

/** A short silent WAV, built at runtime (no file to license or fetch). */
function silentWavUrl(): string {
  const n = 800; // 0.1 s at 8 kHz, 8-bit mono
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const w = (o: number, str: string) => [...str].forEach((c, i) => (bytes[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  w(36, 'data'); dv.setUint32(40, n, true);
  bytes.fill(128, 44);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let unlocked = false;

/**
 * Must be called from a user gesture (tap or click). On iOS Safari this also:
 *  - asks for a "playback" audio session so the ringer switch doesn't mute Web Audio (Safari 17+),
 *  - plays a silent <audio> element, the older workaround for the same problem,
 *  - resumes the context when the page comes back from the background.
 */
export async function unlockAudio(): Promise<void> {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* not supported */
  }
  if (!unlocked) {
    unlocked = true;
    try {
      const el = new Audio(silentWavUrl());
      el.setAttribute('playsinline', '');
      el.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
    document.addEventListener('visibilitychange', () => {
      const ctx = audioContext();
      if (document.visibilityState === 'visible' && ctx.state !== 'running') ctx.resume().catch(() => undefined);
    });
  }
  await Tone.start();
  const ctx = audioContext();
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  ensureGraph();
}

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.rampTo(toGain(v), 0.05);
}

export function getVolume() {
  return volume;
}

/** A quiet test tone for the setup screen. */
export async function playTestTone(): Promise<void> {
  assertGate();
  const { master } = ensureGraph();
  const osc = new Tone.Oscillator(440, 'sine');
  const env = new Tone.Gain(0).connect(master);
  osc.connect(env).start();
  const now = Tone.now();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.12, now + 0.05);
  env.gain.setValueAtTime(0.12, now + 0.95);
  env.gain.linearRampToValueAtTime(0, now + 1);
  await new Promise((r) => setTimeout(r, 1050));
  osc.stop().dispose();
  env.dispose();
}

async function loadSampleFile(s: Stimulus, sr: number): Promise<Float32Array> {
  const res = await fetch(s.file!);
  const decoded = await audioContext().decodeAudioData(await res.arrayBuffer());
  const n = Math.min(decoded.length, Math.round((s.durationMs / 1000) * sr));
  const out = decoded.getChannelData(0).slice(0, n);
  applyFades(out, sr, FADE_MS);
  normalizeLoudness(out, sr, TARGET_LOUDNESS_LUFS);
  return out;
}

/** Prepare all calibration sounds (synthesized placeholders, or files if configured). */
export async function prepareStimuli(stimuli: Stimulus[] = STIMULI): Promise<void> {
  const sr = sampleRate();
  for (const s of stimuli) {
    if (stimulusBuffers.has(s.id)) continue;
    const arr = s.file ? await loadSampleFile(s, sr) : renderStimulus(s, sr);
    stimulusArrays.set(s.id, arr);
    stimulusBuffers.set(s.id, Tone.ToneAudioBuffer.fromArray(arr));
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
}

export function stimulusArray(id: string) {
  return stimulusArrays.get(id);
}

let stimPlayer: Tone.Player | null = null;
let stimDone: (() => void) | null = null;

/** Stop the calibration sound that is playing, with a short fade so there is no click. */
export function stopStimulus(): void {
  if (stimPlayer) {
    const p = stimPlayer;
    stimPlayer = null;
    p.stop();
    setTimeout(() => p.dispose(), 100);
  }
  stimDone?.();
  stimDone = null;
}

/** Play one calibration sound. Resolves when it ends or is stopped. */
export async function playStimulus(s: Stimulus): Promise<void> {
  assertGate();
  stopStimulus();
  const { master } = ensureGraph();
  if (!stimulusBuffers.has(s.id)) await prepareStimuli([s]);
  const player = new Tone.Player(stimulusBuffers.get(s.id)!).connect(master);
  player.fadeOut = 0.03;
  stimPlayer = player;
  player.start();
  await new Promise<void>((resolve) => {
    stimDone = resolve;
    setTimeout(() => {
      if (stimPlayer === player) {
        stimPlayer = null;
        player.dispose();
      }
      resolve();
    }, s.durationMs + 30);
  });
}

/* ------------------------------------------------------------------ */
/* Immersive sources                                                   */
/* ------------------------------------------------------------------ */

let current: Tone.Player | null = null;

export function trackBuffer(id: TrackId): Promise<Tone.ToneAudioBuffer> {
  const cached = trackCache.get(id);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./trackWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ buffer: Float32Array }>) => {
      const buf = Tone.ToneAudioBuffer.fromArray(e.data.buffer);
      trackCache.set(id, buf);
      worker.terminate();
      resolve(buf);
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage({ id, sampleRate: sampleRate() });
  });
}

/** Decode a user's file locally. It never leaves the device. */
export async function decodeFile(file: File): Promise<Tone.ToneAudioBuffer> {
  const decoded = await audioContext().decodeAudioData(await file.arrayBuffer());
  return new Tone.ToneAudioBuffer(decoded);
}

export function playSource(buffer: Tone.ToneAudioBuffer, loop = true): void {
  assertGate();
  const { master, analyser } = ensureGraph();
  stopSource();
  current = new Tone.Player(buffer);
  current.loop = loop;
  current.fadeIn = 0.3;
  current.fadeOut = 0.3;
  current.connect(master);
  current.connect(analyser); // analysis is pre-volume, so volume never changes the visuals
  current.start();
}

export function pauseSource(): void {
  if (current && current.state === 'started') current.stop();
}

export function resumeSource(): void {
  assertGate();
  if (current && current.state !== 'started') current.start();
}

export function stopSource(): void {
  if (current) {
    current.stop();
    current.dispose();
    current = null;
  }
  stopMic();
}

export function isPlaying(): boolean {
  return current?.state === 'started' || micStream != null;
}

/* ------------------------------------------------------------------ */
/* Microphone (Phase 2)                                                */
/* ------------------------------------------------------------------ */

let micStream: MediaStream | null = null;
let micNode: MediaStreamAudioSourceNode | null = null;
/** Bumped by every stop, so a permission prompt that resolves late can't turn the mic back on. */
let micGeneration = 0;

/**
 * Ask for the microphone only now (when the user picks it). The signal goes to the analyser only,
 * never to the speakers, so there is no feedback. Nothing is recorded or uploaded.
 */
export async function startMic(): Promise<void> {
  assertGate();
  const { analyser } = ensureGraph();
  stopSource();
  const gen = ++micGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  if (gen !== micGeneration) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('Microphone was turned off before it started.');
  }
  micStream = stream;
  micNode = audioContext().createMediaStreamSource(stream);
  micNode.connect(analyser);
}

/** Stop the microphone completely (the browser's recording indicator turns off). */
export function stopMic(): void {
  micGeneration++;
  micNode?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  micNode = null;
  micStream = null;
}

export function micActive(): boolean {
  return micStream != null;
}

/** Copy the latest analysis frame (2048 samples) into `out`. */
export function readFrame(out: Float32Array<ArrayBuffer>): void {
  ensureGraph().analyser.getFloatTimeDomainData(out);
}
