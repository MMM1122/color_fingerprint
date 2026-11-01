import type { ReactNode } from 'react';
import { useApp } from '../store/app';
import { cloudEnabled } from '../storage/cloud';

export default function TopBar({ children }: { children?: ReactNode }) {
  const go = useApp((s) => s.go);
  const account = useApp((s) => s.account);
  const sync = useApp((s) => s.sync);
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => go('landing')}>
        Color Fingerprint
      </button>
      <div className="row">
        {children}
        {cloudEnabled &&
          (account ? (
            <button className="link account-link" onClick={() => go('account')}>
              {account.email}
              {sync.status === 'error' && <span className="sync-badge"> (not saved)</span>}
            </button>
          ) : (
            <button className="link" onClick={() => go('account')}>
              Sign in
            </button>
          ))}
      </div>
    </header>
  );
}
