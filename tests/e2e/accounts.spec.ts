import { expect, test, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

/** A finished fingerprint, as if the test had been taken on this device. */
function seededFingerprint(startedAt: string) {
  const timbres = ['piano', 'sine', 'strings', 'voice'];
  const notes: [string, number][] = [['C3', 48], ['A3', 57], ['F4', 65], ['D5', 74], ['B5', 83]];
  const answers = timbres.flatMap((t) =>
    notes.flatMap(([n]) =>
      [1, 2, 3].map((r) => ({
        stimulusId: `${t}-${n}`, repetition: r,
        color: { hex: '#3b6fb6', luv: [45.6, -15.2, -55.1], oklch: [0.53, 0.12, 255] },
        reactionMs: 900, replays: 0, timestamp: startedAt,
      })),
    ),
  );
  const anchors: Record<string, Record<number, number[]>> = {};
  for (const t of timbres) anchors[t] = Object.fromEntries(notes.map(([, m]) => [m, [0.53, 0.12, 255]]));
  return {
    schemaVersion: 1, createdAt: startedAt, sessions: [{ startedAt, answers }], anchors,
    consistency: { overall: 0, perStimulus: {} }, patterns: { pitchLightnessRho: null, timbreHueGaps: {} }, flags: {},
  };
}

const EMAIL = 'yvette.test@example.com';
const PASSWORD = 'correct-horse-battery';

async function signIn(page: Page, email: string, password: string) {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.locator('form').getByRole('button', { name: 'Sign in' }).click();
}

const localFingerprint = (page: Page) =>
  page.evaluate(() => localStorage.getItem('colorFingerprint.fingerprint'));

test('accounts: sign up, sync to a second device, sign out, delete', async ({ browser }) => {
  const backend = new MockSupabase();

  // ---- Device A: has a fingerprint, creates an account ----
  const a = await browser.newContext();
  await backend.install(a);
  const pageA = await a.newPage();
  await pageA.goto('/');
  await pageA.evaluate((fp) => localStorage.setItem('colorFingerprint.fingerprint', JSON.stringify(fp)), seededFingerprint('2026-10-20T10:00:00.000Z'));
  await pageA.reload();
  await pageA.getByRole('button', { name: 'Sign in' }).click();
  await expect(pageA.getByText(/Sounds, microphone and camera never leave your device/)).toBeVisible();
  await pageA.getByRole('button', { name: 'Create an account' }).click();
  await pageA.getByLabel('Email').fill(EMAIL);
  await pageA.getByLabel('Password').fill('short');
  await pageA.getByRole('button', { name: 'Create account' }).click();
  await expect(pageA.getByRole('alert')).toContainText('at least 8 characters');
  await pageA.getByLabel('Password').fill(PASSWORD);
  await pageA.getByRole('button', { name: 'Create account' }).click();

  // Signed in; the device's fingerprint is uploaded to the account.
  await expect(pageA.getByRole('button', { name: EMAIL })).toBeVisible();
  await expect.poll(() => backend.rows.size).toBe(1);
  const saved = [...backend.rows.values()][0] as { sessions: unknown[] };
  expect(saved.sessions).toHaveLength(1);
  await pageA.getByRole('button', { name: EMAIL }).click();
  await expect(pageA.getByText('Your colors are saved to your account.')).toBeVisible();

  // ---- Device B: fresh browser, wrong password first, then signs in and gets the colors ----
  const b = await browser.newContext();
  await backend.install(b);
  const pageB = await b.newPage();
  await pageB.goto('/');
  await expect(pageB.getByRole('button', { name: 'Find your colors' })).toBeVisible();
  expect(await localFingerprint(pageB)).toBeNull();
  await signIn(pageB, EMAIL, 'wrong-password');
  await expect(pageB.getByRole('alert')).toContainText('don’t match an account');
  await pageB.getByLabel('Password').fill(PASSWORD);
  await pageB.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(pageB.getByRole('button', { name: 'See your colors' })).toBeVisible();
  await pageB.getByRole('button', { name: 'See your colors' }).click();
  await expect(pageB.getByRole('heading', { name: 'Your palette' })).toBeVisible();

  // Reload B: still signed in (session persisted), colors still there.
  await pageB.reload();
  await expect(pageB.getByRole('button', { name: EMAIL })).toBeVisible();
  await expect(pageB.getByRole('button', { name: 'See your colors' })).toBeVisible();

  // ---- Sign out on B: this device forgets the colors; the account keeps them ----
  await pageB.getByRole('button', { name: EMAIL }).click();
  await pageB.getByRole('button', { name: 'Sign out' }).click();
  await expect(pageB.getByRole('button', { name: 'Find your colors' })).toBeVisible();
  expect(await localFingerprint(pageB)).toBeNull();
  expect(backend.rows.size).toBe(1);

  // ---- Device A merges: a session done as a guest on B before signing in is kept too ----
  await pageB.evaluate((fp) => localStorage.setItem('colorFingerprint.fingerprint', JSON.stringify(fp)), seededFingerprint('2026-10-25T10:00:00.000Z'));
  await pageB.reload();
  await signIn(pageB, EMAIL, PASSWORD);
  await expect.poll(() => ((backend.rows.values().next().value as { sessions: unknown[] }).sessions.length)).toBe(2);

  // ---- Delete the account from A ----
  await pageA.getByRole('button', { name: 'Delete account…' }).click();
  await pageA.getByRole('button', { name: 'Delete account', exact: true }).click();
  await expect(pageA.getByRole('button', { name: 'Find your colors' })).toBeVisible();
  expect(backend.rows.size).toBe(0);
  expect(backend.users.size).toBe(0);
  expect(await localFingerprint(pageA)).toBeNull();

  await a.close();
  await b.close();
});
