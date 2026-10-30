/**
 * Built-in demo tracks, generated procedurally from the same three timbres. They are original
 * compositions made in code, so there is no third-party license to track. Replace or add real
 * openly licensed recordings in public/tracks/ and list them in ATTRIBUTION.md.
 */
import { TARGET_LOUDNESS_LUFS } from '../config/stimuli';
import type { Timbre } from '../types';
import { normalizeLoudness } from './loudness';
import { renderTone } from './synth';

export type TrackId = 'rain' | 'bloom' | 'voices';
export const TRACKS: { id: TrackId; title: string; description: string }[] = [
  { id: 'rain', title: 'Rain on the keys', description: 'Piano arpeggios across three octaves' },
  { id: 'bloom', title: 'Slow bloom', description: 'Bowed-string chords with a pure-tone melody' },
  { id: 'voices', title: 'Four voices', description: 'Piano, strings, pure tone and a sung "ah" taking turns' },
];

type Note = { t: number; midi: number; dur: number; timbre: Timbre; vel: number };

const CHORDS = {
  C: [48, 52, 55], Am: [45, 48, 52], F: [41, 45, 48], G: [43, 47, 50], Em: [40, 43, 47], Dm: [38, 41, 45],
};

function rainNotes(): Note[] {
  const notes: Note[] = [];
  const prog = [CHORDS.C, CHORDS.Am, CHORDS.F, CHORDS.G, CHORDS.C, CHORDS.Em, CHORDS.F, CHORDS.G];
  const step = 0.3125; // eighth notes at 96 bpm
  let t = 0.2;
  prog.forEach((chord, bar) => {
    const pattern = [0, 1, 2, 3, 4, 5, 4, 3]; // up through two octaves and back
    const tones = [...chord.map((m) => m + 12), ...chord.map((m) => m + 24)];
    pattern.forEach((p, i) => {
      notes.push({ t: t + i * step, midi: tones[p] + (bar % 2 === 1 && p > 3 ? 12 : 0), dur: 1.6, timbre: 'piano', vel: 0.55 + 0.1 * Math.sin(i) });
    });
    notes.push({ t, midi: chord[0], dur: 2.6, timbre: 'piano', vel: 0.6 });
    t += 8 * step;
  });
  return notes;
}

function bloomNotes(): Note[] {
  const notes: Note[] = [];
  const prog = [CHORDS.Dm, CHORDS.F, CHORDS.C, CHORDS.G, CHORDS.Am, CHORDS.F, CHORDS.C, CHORDS.G];
  const melody = [74, 77, 76, 72, 74, 79, 81, 79, 76, 77, 72, 71, 72, 76, 74, 74];
  let t = 0.2;
  prog.forEach((chord, bar) => {
    chord.forEach((m, i) => notes.push({ t: t + i * 0.05, midi: m + 12, dur: 3.9, timbre: 'strings', vel: 0.35 }));
    notes.push({ t: t + 1.0, midi: melody[bar * 2], dur: 1.4, timbre: 'sine', vel: 0.5 });
    notes.push({ t: t + 2.5, midi: melody[bar * 2 + 1], dur: 1.3, timbre: 'sine', vel: 0.45 });
    t += 4;
  });
  return notes;
}

function voicesNotes(): Note[] {
  const notes: Note[] = [];
  let t = 0.2;
  const phrases: { timbre: Timbre; line: number[]; step: number; dur: number }[] = [
    { timbre: 'piano', line: [60, 64, 67, 72, 76, 79], step: 0.32, dur: 1.4 },
    { timbre: 'strings', line: [67, 65, 64, 62, 60], step: 0.55, dur: 0.7 },
    { timbre: 'sine', line: [84, 88, 91, 88, 84], step: 0.4, dur: 0.5 },
    { timbre: 'piano', line: [48, 52, 55, 60, 55, 52], step: 0.32, dur: 1.4 },
    { timbre: 'strings', line: [55, 57, 59, 60, 62, 64], step: 0.5, dur: 0.65 },
    { timbre: 'sine', line: [72, 69, 65, 62, 60], step: 0.45, dur: 0.55 },
    { timbre: 'voice', line: [64, 67, 69, 67, 64], step: 0.6, dur: 0.75 },
  ];
  for (let round = 0; round < 2; round++) {
    for (const p of phrases) {
      p.line.forEach((m, i) => notes.push({ t: t + i * p.step, midi: m + (round ? 2 : 0), dur: p.dur, timbre: p.timbre, vel: 0.5 }));
      t += p.line.length * p.step + 0.6; // breath of silence between voices
    }
  }
  return notes;
}

export function renderTrack(id: TrackId, sampleRate: number): Float32Array {
  const notes = id === 'rain' ? rainNotes() : id === 'bloom' ? bloomNotes() : voicesNotes();
  const end = Math.max(...notes.map((n) => n.t + n.dur)) + 1;
  const out = new Float32Array(Math.ceil(end * sampleRate));
  notes.forEach((n, i) => {
    const fade = n.timbre === 'strings' || n.timbre === 'voice' ? 200 : n.timbre === 'sine' ? 40 : 15;
    const tone = renderTone(n.timbre, n.midi, sampleRate, { durationMs: n.dur * 1000, fadeMs: fade, velocity: n.vel, seed: i + 1 });
    const offset = Math.round(n.t * sampleRate);
    for (let k = 0; k < tone.length && offset + k < out.length; k++) out[offset + k] += tone[k];
  });
  normalizeLoudness(out, sampleRate, TARGET_LOUDNESS_LUFS);
  return out;
}
