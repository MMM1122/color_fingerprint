import { useApp } from '../store/app';
import TopBar from './TopBar';

export function Learn() {
  const go = useApp((s) => s.go);
  return (
    <>
      <TopBar />
      <article className="page stack">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>What is synesthesia?</h1>
        <p>
          Synesthesia is when one sense reliably brings along another. For some people, a sound always comes with a
          color, and the same sound brings the same color year after year. Sound-to-color synesthesia is sometimes
          called chromesthesia.
        </p>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>Why we play each sound three times</h2>
        <p>
          Researchers can't see anyone's colors, so they measure consistency instead. They play each sound several
          times in a random order and check how close the colors are. People with synesthesia tend to pick nearly the
          same color every time. Most other people drift more, because they are guessing rather than seeing.
        </p>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>Patterns most people share</h2>
        <p>
          Many links between sound and color are common to almost everyone. A well-known one: higher notes tend to
          get lighter colors. Ward, Huckstep and Tsakanikos (2006) found this in people with and without synesthesia.
        </p>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>What this site can and can't tell you</h2>
        <p>
          It shows how your own colors behave: how consistent they are and which patterns they follow. It can't say
          whether you have synesthesia. That takes a fuller test and, ideally, a retest weeks later.
        </p>
        <div className="row">
          <button className="primary" onClick={() => go('setup')}>Find your colors</button>
          <button onClick={() => go('landing')}>Back</button>
        </div>
      </article>
    </>
  );
}

export function About() {
  const go = useApp((s) => s.go);
  return (
    <>
      <TopBar />
      <article className="page stack">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>About and credits</h1>
        <p>
          Color Fingerprint measures your sound-to-color associations, then uses them to color music. Everything
          runs in your browser. No account, and no audio or answers leave your device.
        </p>
        <p>
          The microphone and camera are only used if you pick them in the visualizer, and only while you're there.
          They're processed on your device and never recorded or uploaded.
        </p>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>Sounds</h2>
        <p>
          The piano, pure-tone, bowed-string and sung "ah" sounds, and the three built-in tracks, are generated in
          your browser by this site's own code. They are stand-ins until openly licensed recordings are chosen.
        </p>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>Research</h2>
        <ul style={{ maxWidth: 'var(--measure)' }}>
          <li>Eagleman, Kagan, Nelson, Sagaram and Sarma (2007). A standardized test battery for the study of synesthesia. Journal of Neuroscience Methods.</li>
          <li>Rothen, Seth, Witzel and Ward (2013). Diagnosing synaesthesia with online colour pickers: maximising sensitivity and specificity. Journal of Neuroscience Methods, 215, 156–160.</li>
          <li>Ward, Huckstep and Tsakanikos (2006). Sound-colour synaesthesia: to what extent does it use cross-modal mechanisms common to us all? Cortex, 42, 264–280.</li>
        </ul>
        <h2 style={{ fontSize: 'var(--t-lg)' }}>Software</h2>
        <p>Built with React, Zustand, Tone.js, Meyda, Pitchy, culori and Three.js. Full list in ATTRIBUTION.md.</p>
        <p className="quiet">This is a playful experiment, not a medical or diagnostic test.</p>
        <div className="row">
          <button onClick={() => go('landing')}>Back</button>
        </div>
      </article>
    </>
  );
}
