import { lazy, Suspense, useEffect } from 'react';
import { useApp, type Screen } from './store/app';
import Landing from './screens/Landing';
import Setup from './screens/Setup';
import Calibration from './screens/Calibration';
import Results from './screens/Results';
import { Learn, About } from './screens/Info';
import Share from './screens/Share';

// Three.js is only loaded when someone opens immersive mode.
const Immersive = lazy(() => import('./screens/Immersive'));

const TITLES: Record<Screen, string> = {
  landing: 'Color Fingerprint',
  setup: 'Before you start · Color Fingerprint',
  calibration: 'Find your colors · Color Fingerprint',
  results: 'Your colors · Color Fingerprint',
  immersive: 'Music in your colors · Color Fingerprint',
  share: 'Save and share · Color Fingerprint',
  learn: 'What is synesthesia? · Color Fingerprint',
  about: 'About and credits · Color Fingerprint',
};

export default function App() {
  const screen = useApp((s) => s.screen);
  const setupDone = useApp((s) => s.setupDone);
  const go = useApp((s) => s.go);

  useEffect(() => {
    document.title = TITLES[screen];
  }, [screen]);

  // Any screen that makes sound requires setup on this page load.
  useEffect(() => {
    if ((screen === 'calibration' || screen === 'immersive') && !setupDone) go('setup');
  }, [screen, setupDone, go]);

  return (
    <main>
      {screen === 'landing' && <Landing />}
      {screen === 'setup' && <Setup />}
      {screen === 'calibration' && setupDone && <Calibration />}
      {screen === 'results' && <Results />}
      {screen === 'immersive' && setupDone && (
        <Suspense fallback={<h1 className="page" style={{ fontSize: 'var(--t-md)' }}>Loading the visualizer…</h1>}>
          <Immersive />
        </Suspense>
      )}
      {screen === 'share' && <Share />}
      {screen === 'learn' && <Learn />}
      {screen === 'about' && <About />}
    </main>
  );
}
