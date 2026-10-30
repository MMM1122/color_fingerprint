import { useEffect, useRef, useState } from 'react';
import { RETEST_MIN_DAYS } from '../config/stimuli';
import { useApp } from '../store/app';
import { downloadBlob, downloadText, fingerprintFromJson, fingerprintToJson, isPersistent } from '../storage/local';
import { canvasToBlob, drawShareCard, SHARE_TITLE } from '../visuals/shareCard';
import { daysSince, reminderIcs, sessionEnd } from '../science/retest';
import TopBar from './TopBar';

export default function Share() {
  const { fingerprint, setFingerprint, go, startRetest } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    if (!fingerprint || !canvasRef.current) return;
    drawShareCard(canvasRef.current, fingerprint.anchors);
    setPreview(canvasRef.current.toDataURL('image/png'));
    try {
      const probe = new File([new Blob()], 'x.png', { type: 'image/png' });
      setCanShareFiles(!!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, [fingerprint]);

  if (!fingerprint) {
    return (
      <>
        <TopBar />
        <div className="page stack">
          <h1 style={{ fontSize: 'var(--t-xl)' }}>Nothing to share yet</h1>
          <p>Find your colors first, then come back here to save and share them.</p>
          <button className="primary" onClick={() => go('setup')}>Find your colors</button>
        </div>
      </>
    );
  }

  const last = fingerprint.sessions[fingerprint.sessions.length - 1];
  const due = new Date(sessionEnd(last).getTime() + RETEST_MIN_DAYS * 86_400_000);
  const days = daysSince(last);
  const dueText = due.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  async function shareImage() {
    const blob = await canvasToBlob(canvasRef.current!);
    const file = new File([blob], 'color-fingerprint.png', { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: SHARE_TITLE });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setNote("Sharing didn't work here. Download the image instead.");
    }
  }

  return (
    <>
      <TopBar />
      <div className="page stack">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>Save and share</h1>

        <section className="stack" aria-labelledby="card-h">
          <h2 id="card-h" style={{ fontSize: 'var(--t-lg)' }}>Your share card</h2>
          <p>It shows your palette and a title, nothing else: no scores, dates or names.</p>
          <canvas ref={canvasRef} className="visually-hidden" aria-hidden="true" />
          {preview && (
            <img
              src={preview}
              alt="Share card: your palette of average colors, one row per sound and one column per note."
              style={{ width: '100%', maxWidth: '40rem', display: 'block' }}
            />
          )}
          <div className="row">
            <button
              className="primary"
              onClick={async () => downloadBlob('color-fingerprint.png', await canvasToBlob(canvasRef.current!))}
            >
              Download image
            </button>
            {canShareFiles && <button onClick={shareImage}>Share image</button>}
          </div>
        </section>

        <section className="stack panel" aria-labelledby="retest-h">
          <h2 id="retest-h" style={{ fontSize: 'var(--t-lg)' }}>Retest in {RETEST_MIN_DAYS}+ days</h2>
          <p>
            Consistency over days says more than consistency in one sitting. Come back on {dueText} or later and
            we'll compare your new colors with these.
          </p>
          <div className="row">
            <button onClick={() => downloadText('color-fingerprint-retest.ics', reminderIcs(due, location.href.split('#')[0]), 'text/calendar')}>
              Add a reminder to your calendar
            </button>
            <button
              className={days >= RETEST_MIN_DAYS ? 'primary' : undefined}
              onClick={() => {
                startRetest();
                go('setup');
              }}
            >
              {days >= RETEST_MIN_DAYS ? 'Retest now' : 'Retest anyway'}
            </button>
          </div>
          {days < RETEST_MIN_DAYS && <p className="quiet">A retest today still works, but it mostly measures short-term memory.</p>}
        </section>

        <section className="stack panel" aria-labelledby="keep-h">
          <h2 id="keep-h" style={{ fontSize: 'var(--t-lg)' }}>Keep your fingerprint</h2>
          <p className="quiet">
            {isPersistent()
              ? 'It is saved in this browser. Download a copy to keep it safe or move it to another device.'
              : "This browser isn't letting us save, so download a copy before you leave."}
          </p>
          <div className="row">
            <button onClick={() => downloadText(`color-fingerprint-${fingerprint.createdAt.slice(0, 10)}.json`, fingerprintToJson(fingerprint))}>
              Download fingerprint file
            </button>
            <button onClick={() => fileRef.current?.click()}>Open a fingerprint file</button>
          </div>
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
                setFingerprint(fingerprintFromJson(await f.text()));
                setNote('Fingerprint opened.');
              } catch (err) {
                setNote(`That file couldn't be opened: ${(err as Error).message}`);
              }
            }}
          />
        </section>
        {note && <p role="status">{note}</p>}
        <div className="row">
          <button onClick={() => go('results')}>Back to your colors</button>
        </div>
      </div>
    </>
  );
}
