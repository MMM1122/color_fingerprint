import { useMemo, useRef, useState } from 'react';
import { PITCHES_MIDI, RESEARCH_REFERENCE, STIMULI, TIMBRES, TIMBRE_LABELS, midiToName } from '../config/stimuli';
import { useApp } from '../store/app';
import { BAND_TEXT, consistencyBand, detectPatterns, groupByStimulus, scoreConsistency } from '../science/scoring';
import { describeColor, oklchToHex } from '../science/color';
import { downloadText, fingerprintFromJson, fingerprintToJson, isPersistent } from '../storage/local';
import TopBar from './TopBar';

const CARD_TITLES = ['Your palette', 'Your consistency', 'Your patterns', 'Hear it'];

export default function Results() {
  const { fingerprint, go, setFingerprint, discardProgress, startCalibration, setupDone } = useApp();
  const [step, setStep] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const data = useMemo(() => {
    if (!fingerprint) return null;
    const answers = fingerprint.sessions[fingerprint.sessions.length - 1]?.answers ?? [];
    const c = scoreConsistency(answers);
    const p = detectPatterns(answers, STIMULI, c.overall);
    return { answers, c, p, groups: groupByStimulus(answers) };
  }, [fingerprint]);

  if (!fingerprint || !data) {
    return (
      <>
        <TopBar />
        <div className="page stack">
          <h1 style={{ fontSize: 'var(--t-xl)' }}>No colors yet</h1>
          <p>Listen to 45 short sounds and pick a color for each. It takes about 5 minutes.</p>
          <div className="row">
            <button className="primary" onClick={() => go('setup')}>Find your colors</button>
            <button onClick={() => fileRef.current?.click()}>Import a saved fingerprint</button>
          </div>
          <ImportInput fileRef={fileRef} onLoad={setFingerprint} onError={setImportError} />
          {importError && <p role="alert">{importError}</p>}
        </div>
      </>
    );
  }

  const { c, p, groups } = data;
  const band = c.overall != null ? consistencyBand(c.overall) : null;
  const moveTo = (i: number) => {
    setStep(i);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const palette = (
    <>
      <div className="palette" role="img" aria-label="Your palette: rows are sounds, columns are notes from low to high. A text version follows.">
        <span />
        {PITCHES_MIDI.map((m) => (
          <span key={m} className="head">{midiToName(m)}</span>
        ))}
        {TIMBRES.map((t) => (
          <Row key={t} timbre={t} anchors={fingerprint.anchors[t]} groups={groups} />
        ))}
      </div>
      <details>
        <summary>Text version of your palette</summary>
        <table className="text-palette">
          <thead>
            <tr><th scope="col">Sound</th><th scope="col">Note</th><th scope="col">Average color</th></tr>
          </thead>
          <tbody>
            {TIMBRES.flatMap((t) =>
              PITCHES_MIDI.map((m) => {
                const a = fingerprint.anchors[t]?.[m];
                return (
                  <tr key={`${t}${m}`}>
                    <td>{TIMBRE_LABELS[t]}</td>
                    <td>{midiToName(m)}</td>
                    <td>{a ? `${describeColor(a)} (${oklchToHex(a)})` : 'No color'}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </details>
    </>
  );

  const cards = [
    <>
      <p>Each square is the average of the three colors you picked for that sound. The thin strip shows all three.</p>
      {palette}
    </>,
    <>
      {band ? (
        <>
          <p className="score">Your colors for the same sound were {BAND_TEXT[band]}.</p>
          <p>
            You heard each sound three times. People with sound–color synesthesia tend to pick nearly the same color
            every time. That is why researchers measure consistency.
          </p>
        </>
      ) : (
        <p className="score">There weren't enough colors to measure consistency.</p>
      )}
      {c.lowReliability && (
        <p>More than a third of your answers were "No color comes to mind", so this score is less reliable.</p>
      )}
      {c.overall != null && (
        <details>
          <summary>The numbers</summary>
          <p className="quiet" style={{ marginTop: '0.75rem' }}>
            Average color distance between your repeat answers: {c.overall.toFixed(1)} (CIELUV ΔE, lower is more
            consistent), across {c.scoredStimuli} sounds. Summed over the three pairs, as in the research literature:{' '}
            {c.overallLuvSum!.toFixed(1)}. Rothen and colleagues (2013) suggest {RESEARCH_REFERENCE.rothenLuvSumCutoff} on that
            scale as a reference point
            {c.eaglemanRgb != null && (
              <>; your score on Eagleman and colleagues' (2007) RGB scale is {c.eaglemanRgb.toFixed(2)}, against their
              reference point of {RESEARCH_REFERENCE.eaglemanRgbSumCutoff.toFixed(1)}</>
            )}
            . Both were tested with {RESEARCH_REFERENCE.validatedFor}, not sounds, so treat them as context only.
          </p>
        </details>
      )}
    </>,
    <>
      <ul className="stack" style={{ paddingLeft: '1.2rem', maxWidth: 'var(--measure)' }}>
        {p.pitchLightness && (
          <li>
            Higher notes got lighter colors. Most people do this too, synesthetes or not (Ward, Huckstep and
            Tsakanikos, 2006).
          </li>
        )}
        {p.timbreHue[0] && (
          <li>
            {TIMBRE_LABELS[p.timbreHue[0].a]} and {TIMBRE_LABELS[p.timbreHue[0].b].toLowerCase()} got clearly
            different colors.
          </li>
        )}
        {p.strongMapping && <li>Your answers were unusually consistent.</li>}
        {p.none && <li>Your colors don't follow the common patterns, which is interesting too.</li>}
      </ul>
      <p>These patterns describe your answers today. They don't say whether you have synesthesia; only a fuller test can tell more.</p>
      {fingerprint.flags.colorVisionDifference && (
        <p>You mentioned a color vision difference. That can affect which colors you pick, so keep it in mind when reading these results.</p>
      )}
    </>,
    <>
      <p>Your palette now drives the music visualizer. Notes and sounds take on the colors you chose.</p>
      <div className="row">
        <button className="primary" onClick={() => go(setupDone ? 'immersive' : 'setup')}>
          Hear music in your colors
        </button>
      </div>
      <div className="panel stack">
        <h2 style={{ fontSize: 'var(--t-md)' }}>Keep your fingerprint</h2>
        <p className="quiet">
          {isPersistent()
            ? 'It is saved in this browser. Download a copy to keep it safe or move it to another device.'
            : "This browser isn't letting us save, so download a copy before you leave."}
        </p>
        <div className="row">
          <button
            onClick={() =>
              downloadText(`color-fingerprint-${fingerprint.createdAt.slice(0, 10)}.json`, fingerprintToJson(fingerprint))
            }
          >
            Download fingerprint
          </button>
          <button onClick={() => fileRef.current?.click()}>Import a fingerprint</button>
          <button
            className="link"
            onClick={() => {
              discardProgress();
              startCalibration();
              go('setup');
            }}
          >
            Take the test again
          </button>
        </div>
        <ImportInput fileRef={fileRef} onLoad={(fp) => (setFingerprint(fp), moveTo(0))} onError={setImportError} />
        {importError && <p role="alert">{importError}</p>}
      </div>
    </>,
  ];

  return (
    <>
      <TopBar />
      <div className="page story">
        <section className="card" aria-labelledby="card-title">
          <h1 id="card-title" ref={headingRef} tabIndex={-1} style={{ fontSize: 'var(--t-xl)', outline: 'none' }}>
            {CARD_TITLES[step]}
          </h1>
          {cards[step]}
        </section>
        <nav aria-label="Results">
          <button onClick={() => moveTo(step - 1)} disabled={step === 0}>Back</button>
          <ol className="dots" aria-label={`Card ${step + 1} of ${cards.length}`}>
            {cards.map((_, i) => (
              <li key={i} aria-current={i === step ? 'step' : undefined} />
            ))}
          </ol>
          {step < cards.length - 1 ? (
            <button className="primary" onClick={() => moveTo(step + 1)}>Next</button>
          ) : (
            <span style={{ width: '5rem' }} />
          )}
        </nav>
        <p className="quiet" style={{ marginTop: '1.5rem' }}>This is a playful experiment, not a medical or diagnostic test.</p>
      </div>
    </>
  );
}

function Row({
  timbre,
  anchors,
  groups,
}: {
  timbre: (typeof TIMBRES)[number];
  anchors: Record<number, [number, number, number] | null> | undefined;
  groups: Map<string, import('../types').Answer[]>;
}) {
  return (
    <>
      <span className="rowname">{TIMBRE_LABELS[timbre]}</span>
      {PITCHES_MIDI.map((m) => {
        const a = anchors?.[m];
        const reps = groups.get(`${timbre}-${midiToName(m)}`) ?? [];
        return (
          <div key={m} className={`tile${a ? '' : ' empty'}`} style={a ? { background: oklchToHex(a) } : undefined}>
            <div className="reps">
              {reps.map((r, i) => (
                <span key={i} style={{ background: r.color?.hex ?? 'transparent' }} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ImportInput({
  fileRef,
  onLoad,
  onError,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>;
  onLoad(fp: import('../types').Fingerprint): void;
  onError(msg: string | null): void;
}) {
  return (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          onLoad(fingerprintFromJson(await f.text()));
          onError(null);
        } catch (err) {
          onError(`That file couldn't be opened: ${(err as Error).message}`);
        }
      }}
    />
  );
}
