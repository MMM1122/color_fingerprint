import { useEffect, useRef } from 'react';
import { useApp } from '../store/app';
import { oklchToHex } from '../science/color';
import TopBar from './TopBar';
import { ESTIMATED_MINUTES } from '../config/stimuli';
import { retestDue } from '../science/retest';

/**
 * Calm animated preview: a few soft color fields drifting slowly. No flashing; brightness never
 * changes quickly. Static when reduced motion is on.
 */
function Preview({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const blobs = [
      { h: 255, l: 0.62, x: 0.25, y: 0.35, r: 0.42, sx: 0.013, sy: 0.009 },
      { h: 35, l: 0.68, x: 0.7, y: 0.3, r: 0.36, sx: 0.009, sy: 0.012 },
      { h: 160, l: 0.72, x: 0.55, y: 0.7, r: 0.4, sx: 0.011, sy: 0.008 },
      { h: 320, l: 0.55, x: 0.2, y: 0.8, r: 0.3, sx: 0.008, sy: 0.01 },
    ].map((b) => ({ ...b, hex: oklchToHex([b.l, 0.12, b.h]) }));
    let raf = 0;
    const draw = (t: number) => {
      const w = (canvas.width = canvas.clientWidth * Math.min(2, devicePixelRatio));
      const h = (canvas.height = canvas.clientHeight * Math.min(2, devicePixelRatio));
      ctx.fillStyle = '#1d1d1d';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        const x = (b.x + 0.08 * Math.sin(t * b.sx * 0.06)) * w;
        const y = (b.y + 0.06 * Math.cos(t * b.sy * 0.06)) * h;
        const r = b.r * Math.max(w, h);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, b.hex + '88');
        g.addColorStop(1, b.hex + '00');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
      if (!still) raf = requestAnimationFrame((n) => draw(n / 1000));
    };
    draw(still ? 0 : performance.now() / 1000);
    return () => cancelAnimationFrame(raf);
  }, [still]);
  return <canvas className="preview" ref={ref} aria-hidden="true" />;
}

export default function Landing() {
  const { go, fingerprint, progress, prefs, startRetest } = useApp();
  const due = !progress && fingerprint && retestDue(fingerprint.sessions[fingerprint.sessions.length - 1]);
  return (
    <div className="landing">
      <Preview still={prefs.reducedMotion} />
      <TopBar>
        <button className="link" onClick={() => go('learn')}>
          What is synesthesia?
        </button>
      </TopBar>
      <div className="hero">
        <h1>What does music look like to you?</h1>
        <p>Listen to a few sounds, pick the colors they bring to mind, then hear music in your own colors.</p>
        <div className="row" style={{ marginTop: '1.75rem' }}>
          <button className="primary" onClick={() => go('setup')}>
            {progress ? 'Continue finding your colors' : fingerprint ? 'Start over' : 'Find your colors'}
          </button>
          {fingerprint && (
            <button onClick={() => go('results')}>See your colors</button>
          )}
          {due && (
            <button
              onClick={() => {
                startRetest();
                go('setup');
              }}
            >
              Retest your colors
            </button>
          )}
        </div>
        {!progress && !fingerprint && <p className="quiet" style={{ marginTop: '1rem' }}>Takes about {ESTIMATED_MINUTES} minutes. Headphones help.</p>}
      </div>
      <footer className="row quiet">
        <span>A playful experiment, not a medical or diagnostic test.</span>
        <button className="link" onClick={() => go('about')}>About and credits</button>
      </footer>
    </div>
  );
}
