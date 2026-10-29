import type { ReactNode } from 'react';
import { useApp } from '../store/app';

export default function TopBar({ children }: { children?: ReactNode }) {
  const go = useApp((s) => s.go);
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => go('landing')}>
        Color Fingerprint
      </button>
      <div className="row">{children}</div>
    </header>
  );
}
