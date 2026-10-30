/**
 * Conversational guide (optional Phase 3 extra). Scripted, not an AI service: it works offline and
 * never sends anything anywhere. It talks only about the user's own answers plus science the site
 * already cites (the consistency method; pitch → lightness, Ward, Huckstep & Tsakanikos 2006).
 * It is off the critical path: nothing else depends on it.
 */
import { useMemo, useState } from 'react';
import { STIMULI, TIMBRE_LABELS, midiToName } from '../config/stimuli';
import { playStimulus, soundAllowed } from '../audio/engine';
import { describeColor, oklchToHex } from '../science/color';
import { stimulusMeans } from '../science/scoring';
import type { Answer, Oklch } from '../types';
import { useApp } from '../store/app';

const WORDS = ['Warm', 'Cool', 'Bright', 'Dark', 'Soft', 'Sharp', 'Heavy', 'Light'] as const;
type Word = (typeof WORDS)[number];

type Turn = { from: 'guide' | 'you'; text: string; swatch?: string };

const byId = new Map(STIMULI.map((s) => [s.id, s]));

/** Is this hue warm (reds to yellows), cool (greens to blues/violets), or in between? */
function warmth([, c, h]: Oklch): 'warm' | 'cool' | 'neutral' {
  if (c < 0.04) return 'neutral';
  if (h < 100 || h >= 340) return 'warm';
  if (h >= 150 && h < 300) return 'cool';
  return 'neutral';
}

export function reflect(word: Word, color: Oklch): string {
  const [l] = color;
  const tone = warmth(color);
  const name = describeColor(color);
  const lightPct = Math.round(l * 100);
  const base = `You called it ${word.toLowerCase()}. The color you gave it was ${name}, at ${lightPct}% lightness.`;
  switch (word) {
    case 'Bright':
    case 'Light':
      return l >= 0.65
        ? `${base} Your word and your color agree: both are on the light side.`
        : `${base} Your color is darker than your word suggests. Feelings and colors don't always line up, and that's fine.`;
    case 'Dark':
    case 'Heavy':
      return l <= 0.5
        ? `${base} Your word and your color agree: both are on the dark side.`
        : `${base} Your color is lighter than your word suggests. Feelings and colors don't always line up, and that's fine.`;
    case 'Warm':
    case 'Cool':
      return tone === word.toLowerCase()
        ? `${base} That hue sits on the ${tone} side of the color wheel too.`
        : tone === 'neutral'
          ? `${base} That hue is neither clearly warm nor cool.`
          : `${base} That hue sits on the ${tone} side of the color wheel, so your word and color pull different ways.`;
    default:
      return `${base} There's no common rule for "${word.toLowerCase()}", so this one is all yours.`;
  }
}

export default function Guide({ answers, pitchLightness }: { answers: Answer[]; pitchLightness: boolean }) {
  const go = useApp((s) => s.go);
  const means = useMemo(() => stimulusMeans(answers), [answers]);
  const ids = useMemo(() => [...means.keys()].sort(() => Math.random() - 0.5), [means]);
  const [i, setI] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [stage, setStage] = useState<'intro' | 'ask' | 'done'>('intro');

  const id = ids[i % Math.max(1, ids.length)];
  const s = id ? byId.get(id) : undefined;
  const color = id ? means.get(id) : undefined;
  if (!s || !color) return <p>Answer a few sounds with a color first, then the guide can talk them through.</p>;

  const label = `${TIMBRE_LABELS[s.timbre].toLowerCase()} at ${midiToName(s.midi)}`;

  function start() {
    setTurns((t) => [...t, { from: 'guide', text: `Let's listen to the ${label} again. What does this sound feel like?` }]);
    setStage('ask');
    if (soundAllowed()) playStimulus(s!).catch(() => undefined);
  }

  function answer(word: Word) {
    const next: Turn[] = [
      { from: 'you', text: word },
      { from: 'guide', text: reflect(word, color!), swatch: oklchToHex(color!) },
    ];
    if (turns.filter((t) => t.from === 'you').length === 0) {
      next.push({
        from: 'guide',
        text:
          'Researchers can’t see anyone’s colors, so they look at consistency instead: the same sound, three times, in random order. Close colors each time are what people with synesthesia tend to show.' +
          (pitchLightness
            ? ' You also gave higher notes lighter colors. Ward, Huckstep and Tsakanikos (2006) found people with and without synesthesia do this.'
            : ''),
      });
    }
    setTurns((t) => [...t, ...next]);
    setStage('done');
  }

  return (
    <div className="guide stack">
      <div role="log" aria-live="polite" className="stack">
        {turns.map((t, k) => (
          <p key={k} className={`turn ${t.from}`}>
            {t.swatch && <span className="dot" style={{ background: t.swatch }} aria-hidden="true" />}
            <span className="visually-hidden">{t.from === 'guide' ? 'Guide: ' : 'You: '}</span>
            {t.text}
          </p>
        ))}
      </div>
      {stage === 'intro' && (
        <div className="row">
          <button className="primary" onClick={start}>
            Start
          </button>
        </div>
      )}
      {stage === 'ask' && (
        <div className="row" role="group" aria-label="How does it feel?">
          {WORDS.map((w) => (
            <button key={w} onClick={() => answer(w)}>
              {w}
            </button>
          ))}
          {soundAllowed() && (
            <button className="link" onClick={() => playStimulus(s).catch(() => undefined)}>
              Play it again
            </button>
          )}
        </div>
      )}
      {stage === 'done' && (
        <div className="row">
          <button
            onClick={() => {
              setI((x) => x + 1);
              setStage('intro');
            }}
          >
            Try another sound
          </button>
        </div>
      )}
      {!soundAllowed() && stage !== 'done' && (
        <p className="quiet">
          Sound is off until you confirm the setup screen.{' '}
          <button className="link" onClick={() => go('setup')}>
            Go to setup
          </button>
        </p>
      )}
    </div>
  );
}
