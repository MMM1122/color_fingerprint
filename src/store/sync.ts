/**
 * Keeps the fingerprint on this device and the one in the account in step.
 *  - On sign-in (or page load while signed in): merge device + account, save the result to both.
 *  - Whenever the fingerprint changes while signed in: upload it (debounced).
 * Does nothing at all when accounts aren't configured.
 */
import { cloudEnabled, fetchRemote, pushRemote, supabase, toAccount } from '../storage/cloud';
import { mergeFingerprints, sameSessions } from '../storage/merge';
import type { Fingerprint } from '../types';
import { useApp } from './app';

let lastUploaded = '';
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

/** Did the account's copy receive everything on this device? */
export function deviceIsSynced(): boolean {
  const { fingerprint, sync } = useApp.getState();
  if (!fingerprint) return true;
  return sync.status === 'synced' && JSON.stringify(fingerprint) === lastUploaded;
}

async function upload(userId: string, fp: Fingerprint) {
  const json = JSON.stringify(fp);
  if (json === lastUploaded) {
    useApp.getState().setSync({ status: 'synced', at: Date.now() });
    return;
  }
  useApp.getState().setSync({ status: 'syncing' });
  try {
    await pushRemote(userId, fp);
    lastUploaded = json;
    useApp.getState().setSync({ status: 'synced', at: Date.now() });
  } catch (e) {
    useApp.getState().setSync({ status: 'error', message: (e as Error).message });
  }
}

export async function syncNow(): Promise<void> {
  const { account, fingerprint, setFingerprint, setSync } = useApp.getState();
  if (!account) return;
  setSync({ status: 'syncing' });
  try {
    const remote = await fetchRemote(account.id);
    const merged = mergeFingerprints(fingerprint, remote);
    if (!merged) {
      setSync({ status: 'synced', at: Date.now() });
      return;
    }
    if (!sameSessions(merged, fingerprint) || !fingerprint) setFingerprint(merged);
    if (remote && sameSessions(merged, remote)) {
      lastUploaded = JSON.stringify(useApp.getState().fingerprint);
      // Make sure the remote copy is exactly what we hold (rebuilt scores, flags).
      if (JSON.stringify(remote) !== lastUploaded) await upload(account.id, useApp.getState().fingerprint!);
      else setSync({ status: 'synced', at: Date.now() });
    } else {
      await upload(account.id, useApp.getState().fingerprint!);
    }
  } catch (e) {
    setSync({ status: 'error', message: (e as Error).message });
  }
}

export function startCloudSync(): void {
  if (started || !cloudEnabled) return;
  started = true;
  const sb = supabase()!;

  sb.auth.onAuthStateChange((event, session) => {
    const app = useApp.getState();
    const account = toAccount(session?.user);
    if (event === 'PASSWORD_RECOVERY') {
      app.setAccount(account);
      app.setPasswordRecovery(true);
      app.go('account');
      return;
    }
    const changed = account?.id !== app.account?.id;
    app.setAccount(account);
    if (!account) {
      lastUploaded = '';
      return;
    }
    // Defer: Supabase asks callers not to await other Supabase calls inside this callback.
    if (changed || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(() => syncNow(), 0);
  });

  // Upload whenever the fingerprint changes while signed in.
  useApp.subscribe((s, prev) => {
    if (!s.account || !s.fingerprint || s.fingerprint === prev.fingerprint) return;
    clearTimeout(pushTimer);
    const userId = s.account.id;
    const fp = s.fingerprint;
    pushTimer = setTimeout(() => upload(userId, fp), 400);
  });

  // Retry after coming back online.
  window.addEventListener('online', () => {
    if (useApp.getState().sync.status === 'error') syncNow();
  });
}
