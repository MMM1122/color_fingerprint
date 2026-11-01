import { useState, type FormEvent } from 'react';
import { useApp } from '../store/app';
import { deviceIsSynced, syncNow } from '../store/sync';
import {
  cloudEnabled,
  deleteAccount,
  friendlyAuthError,
  sendPasswordReset,
  setNewPassword,
  signIn,
  signOut,
  signUp,
} from '../storage/cloud';
import TopBar from './TopBar';

type Mode = 'signin' | 'signup' | 'reset';

const MIN_PASSWORD = 8;

export default function Account() {
  const { account, passwordRecovery } = useApp();
  return (
    <>
      <TopBar />
      <div className="page stack">
        {!cloudEnabled ? (
          <>
            <h1 style={{ fontSize: 'var(--t-xl)' }}>Accounts aren't set up here</h1>
            <p>This copy of the site runs without accounts. Everything still works and is saved in this browser.</p>
          </>
        ) : passwordRecovery ? (
          <NewPassword />
        ) : account ? (
          <SignedIn />
        ) : (
          <SignInForm />
        )}
      </div>
    </>
  );
}

function WhatWeStore() {
  return (
    <p className="quiet">
      Signing in saves your color answers and results to your account, so you can use them on any device. Sounds,
      microphone and camera never leave your device. You don't need an account to use the site.
    </p>
  );
}

function SignInForm() {
  const go = useApp((s) => s.go);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode !== 'reset' && password.length < MIN_PASSWORD) {
      setError(`Use a longer password: at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        go('landing');
      } else if (mode === 'signup') {
        const r = await signUp(email.trim(), password);
        if (r.needsConfirmation) {
          setInfo(`We sent a confirmation link to ${email.trim()}. Open it, then come back and sign in.`);
          setMode('signin');
          setPassword('');
        } else {
          go('landing');
        }
      } else {
        await sendPasswordReset(email.trim());
        setInfo(`If there's an account for ${email.trim()}, we've sent a link to reset the password.`);
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create an account' : 'Reset your password';
  const action = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link';

  return (
    <>
      <h1 style={{ fontSize: 'var(--t-xl)' }}>{title}</h1>
      <WhatWeStore />
      <form className="stack auth-form" onSubmit={submit} noValidate>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === 'signup' ? 'pw-hint' : undefined}
            />
            {mode === 'signup' && (
              <small id="pw-hint" className="quiet">
                At least {MIN_PASSWORD} characters.
              </small>
            )}
          </label>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {info && <p role="status">{info}</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={busy || !email}>
            {busy ? 'Please wait…' : action}
          </button>
        </div>
      </form>
      <div className="row quiet">
        {mode !== 'signin' && (
          <button className="link" onClick={() => (setMode('signin'), setError(null))}>
            I have an account
          </button>
        )}
        {mode !== 'signup' && (
          <button className="link" onClick={() => (setMode('signup'), setError(null))}>
            Create an account
          </button>
        )}
        {mode !== 'reset' && (
          <button className="link" onClick={() => (setMode('reset'), setError(null))}>
            Forgot your password?
          </button>
        )}
      </div>
    </>
  );
}

function NewPassword() {
  const { setPasswordRecovery, go } = useApp();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Use a longer password: at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    try {
      await setNewPassword(password);
      setPasswordRecovery(false);
      go('landing');
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--t-xl)' }}>Choose a new password</h1>
      <form className="stack auth-form" onSubmit={submit} noValidate>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="quiet">At least {MIN_PASSWORD} characters.</small>
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="row">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </div>
      </form>
    </>
  );
}

function SignedIn() {
  const { account, sync, fingerprint, go, clearLocal } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [signOutWarning, setSignOutWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const statusText =
    sync.status === 'syncing'
      ? 'Saving to your account…'
      : sync.status === 'synced'
        ? fingerprint
          ? 'Your colors are saved to your account.'
          : 'Your colors will be saved to your account once you take the test.'
        : sync.status === 'error'
          ? `Couldn't save to your account: ${friendlyAuthError({ message: sync.message })}`
          : '';

  async function doSignOut(force = false) {
    if (!force && !deviceIsSynced()) {
      setSignOutWarning(true);
      return;
    }
    setBusy(true);
    await signOut();
    // The account keeps its copy; this device forgets it, so the next person here starts fresh.
    clearLocal();
    setBusy(false);
    go('landing');
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      clearLocal();
      go('landing');
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--t-xl)' }}>Your account</h1>
      <p>
        Signed in as <strong>{account!.email}</strong>.
      </p>
      <p role="status" aria-live="polite">
        {statusText}
      </p>
      <div className="row">
        {sync.status === 'error' && (
          <button className="primary" onClick={() => syncNow()}>
            Try saving again
          </button>
        )}
        <button onClick={() => go(fingerprint ? 'results' : 'setup')}>{fingerprint ? 'See your colors' : 'Find your colors'}</button>
        <button onClick={() => doSignOut()} disabled={busy}>
          Sign out
        </button>
      </div>
      {signOutWarning && (
        <div className="panel stack" role="alert">
          <p>
            Some of your colors aren't saved to your account yet. If you sign out now, they'll be removed from this
            device.
          </p>
          <div className="row">
            <button className="primary" onClick={() => (setSignOutWarning(false), syncNow())}>
              Save first
            </button>
            <button onClick={() => doSignOut(true)}>Sign out anyway</button>
          </div>
        </div>
      )}
      <p className="quiet">Signing out removes your colors from this device. They stay in your account.</p>
      <WhatWeStore />

      <section className="panel stack" aria-labelledby="delete-h">
        <h2 id="delete-h" style={{ fontSize: 'var(--t-md)' }}>
          Delete your account
        </h2>
        <p className="quiet">This permanently deletes your account and every color answer saved with it.</p>
        {!confirmDelete ? (
          <div className="row">
            <button onClick={() => setConfirmDelete(true)}>Delete account…</button>
          </div>
        ) : (
          <div className="stack">
            <p role="alert">Delete {account!.email} and all its saved colors? This can't be undone.</p>
            <div className="row">
              <button className="danger" onClick={doDelete} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
              <button onClick={() => setConfirmDelete(false)}>Keep my account</button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
