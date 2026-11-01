/**
 * Accounts and cloud sync (Supabase). Optional: when the two VITE_SUPABASE_* settings are missing,
 * `cloudEnabled` is false and the site works exactly as before, with no account features.
 *
 * What is stored: the fingerprint JSON (answers, colors, scores). Never audio, microphone or camera
 * data. Each person can read and change only their own row (row-level security, see
 * supabase/migrations/001_accounts.sql).
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Fingerprint } from '../types';
import { migrate } from './local';

const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const cloudEnabled = Boolean(URL && KEY);

/** localStorage that never throws (sandboxed frames, private mode): falls back to memory. */
const memory = new Map<string, string>();
const safeStorage = {
  getItem(k: string) {
    try {
      return window.localStorage.getItem(k) ?? memory.get(k) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem(k: string, v: string) {
    memory.set(k, v);
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* memory only */
    }
  },
  removeItem(k: string) {
    memory.delete(k);
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!cloudEnabled) return null;
  client ??= createClient(URL!, KEY!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: safeStorage,
      storageKey: 'colorFingerprint.auth',
    },
  });
  return client;
}

export type Account = { id: string; email: string };
export const toAccount = (u: User | null | undefined): Account | null => (u ? { id: u.id, email: u.email ?? '' } : null);

/** Where Supabase's emails (confirm, reset password) should send people back to. */
export function siteUrl(): string {
  return window.location.origin + window.location.pathname;
}

/** Turn Supabase's error messages into plain, actionable copy. */
export function friendlyAuthError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'That email and password don’t match an account.';
  if (m.includes('email not confirmed')) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'There’s already an account with that email. Sign in instead.';
  if (m.includes('password should be at least') || m.includes('weak')) return 'Use a longer password: at least 8 characters.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries in a short time. Wait a few minutes and try again.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Can’t reach the server. Check your connection and try again.';
  return msg;
}

export async function signUp(email: string, password: string) {
  const sb = supabase()!;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: siteUrl() } });
  if (error) throw error;
  // With "Confirm email" on, there is a user but no session until they click the link.
  return { account: toAccount(data.user), needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase()!.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return toAccount(data.user);
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase()!.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
  if (error) throw error;
}

export async function setNewPassword(password: string) {
  const { error } = await supabase()!.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await supabase()?.auth.signOut();
}

export async function fetchRemote(userId: string): Promise<Fingerprint | null> {
  const { data, error } = await supabase()!
    .from('fingerprints')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? migrate(data.data) : null;
}

export async function pushRemote(userId: string, fp: Fingerprint): Promise<void> {
  const { error } = await supabase()!
    .from('fingerprints')
    .upsert({ user_id: userId, data: fp, schema_version: fp.schemaVersion }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** Deletes the account and, through the database cascade, everything saved with it. */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase()!.rpc('delete_my_account');
  if (error) throw error;
  await supabase()!.auth.signOut();
}
