/**
 * localStorage wrapper. Every access is in try/catch; if storage fails (private mode, quota,
 * sandboxed iframe) data stays in memory for this visit and the UI offers JSON export.
 */
import type { Fingerprint } from '../types';

const PREFIX = 'colorFingerprint.';
const memory = new Map<string, string>();
let storageWorks: boolean | null = null;

export function isPersistent(): boolean {
  if (storageWorks !== null) return storageWorks;
  try {
    const k = `${PREFIX}__probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
  return storageWorks;
}

export function save<T>(key: string, value: T): void {
  const text = JSON.stringify(value);
  memory.set(key, text);
  try {
    window.localStorage.setItem(PREFIX + key, text);
  } catch {
    storageWorks = false;
  }
}

export function load<T>(key: string): T | null {
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(PREFIX + key);
  } catch {
    storageWorks = false;
  }
  text ??= memory.get(key) ?? null;
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function remove(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Fingerprint versioning, export and import                           */
/* ------------------------------------------------------------------ */

export const CURRENT_SCHEMA = 1 as const;

/** Migrations keyed by the version they upgrade FROM. Add one whenever schemaVersion changes. */
const migrations: Record<number, (old: any) => any> = {
  // 1: (v1) => ({ ...v1, schemaVersion: 2, ... }),
};

export function migrate(raw: unknown): Fingerprint {
  if (!raw || typeof raw !== 'object') throw new Error('Not a fingerprint file.');
  let obj: any = raw;
  if (typeof obj.schemaVersion !== 'number') throw new Error('Missing schemaVersion.');
  if (obj.schemaVersion > CURRENT_SCHEMA) {
    throw new Error('This file was made by a newer version of the site.');
  }
  while (obj.schemaVersion < CURRENT_SCHEMA) {
    const step = migrations[obj.schemaVersion];
    if (!step) throw new Error(`No migration from schema ${obj.schemaVersion}.`);
    obj = step(obj);
  }
  if (!Array.isArray(obj.sessions) || typeof obj.anchors !== 'object') {
    throw new Error('Fingerprint file is incomplete.');
  }
  return obj as Fingerprint;
}

export function saveFingerprint(fp: Fingerprint): void {
  save('fingerprint', fp);
}

export function loadFingerprint(): Fingerprint | null {
  const raw = load<unknown>('fingerprint');
  if (!raw) return null;
  try {
    return migrate(raw);
  } catch {
    return null;
  }
}

export function fingerprintToJson(fp: Fingerprint): string {
  return JSON.stringify(fp, null, 2);
}

export function fingerprintFromJson(text: string): Fingerprint {
  return migrate(JSON.parse(text));
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
