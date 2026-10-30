import { expect, test, type Page } from '@playwright/test';

const HUE: Record<string, number> = { piano: 250, sine: 140, strings: 30, voice: 320 };
const TOTAL = 60;
const LIGHT: Record<string, number> = { C3: 30, A3: 42, F4: 55, D5: 68, B5: 82 };

async function setup(page: Page, fromLanding = true) {
  if (fromLanding) await page.getByRole('button', { name: /Find your colors|Continue finding your colors/ }).click();
  const tone = page.getByRole('button', { name: 'Play test tone' });
  await expect(tone).toBeDisabled(); // no sound before confirmations
  await expect(page.getByRole('button', { name: /Start listening|Continue listening|Start the retest/ })).toBeDisabled();
  await page.getByLabel(/wearing headphones/).check();
  await page.getByLabel(/moving light and color/).check();
  await tone.click();
  await expect(page.getByRole('button', { name: 'Play test tone again' })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /Start listening|Continue listening|Start the retest/ }).click();
}

async function answer(page: Page) {
  const trial = page.locator('[data-stimulus]');
  await expect(trial).toBeVisible({ timeout: 15000 });
  const id = (await trial.getAttribute('data-stimulus'))!;
  const [timbre, note] = id.split(/-(?=[A-G]#?\d$)/);
  await expect(page.getByRole('button', { name: /Playing|Play again/ })).toBeVisible();
  await page.getByLabel('Hue', { exact: true }).fill(String(HUE[timbre]));
  await page.getByLabel('Lightness', { exact: true }).fill(String(LIGHT[note]));
  await page.getByLabel('Colorfulness', { exact: true }).fill('12');
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeEnabled({ timeout: 5000 });
  await next.click();
  return id;
}

test.setTimeout(300_000);

test('full flow: setup, 60 trials with resume after reload, results, immersive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What does music look like to you?' })).toBeVisible();
  await setup(page);

  for (let i = 0; i < 5; i++) await answer(page);
  await expect(page.getByText(`Sound 6 of ${TOTAL}`)).toBeVisible();

  // Pause, reload, resume where we left off.
  await page.reload();
  await setup(page);
  await expect(page.getByText(`Sound 6 of ${TOTAL}`)).toBeVisible();

  const seen: string[] = [];
  for (let i = 5; i < TOTAL; i++) {
    const id = await answer(page);
    if (seen.length) expect(id).not.toBe(seen[seen.length - 1]);
    seen.push(id);
  }

  await expect(page.getByRole('heading', { name: 'Your palette' })).toBeVisible({ timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('colorFingerprint.fingerprint')!));
  const answers = saved.sessions[0].answers;
  expect(answers).toHaveLength(TOTAL);
  for (const a of answers) {
    expect(a.color.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(a.color.luv).toHaveLength(3);
    expect(a.color.oklch).toHaveLength(3);
    expect(typeof a.reactionMs).toBe('number');
    expect(typeof a.replays).toBe('number');
  }

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Your colors for the same sound were very close.')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/Higher notes got lighter colors/)).toBeVisible();
  await expect(page.getByText(/got clearly different colors/)).toBeVisible();
  await expect(page.getByText(/unusually consistent/)).toBeVisible();
  await expect(page.getByText(/don't follow the common patterns/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByRole('button', { name: 'Hear music in your colors' }).click();
  await page.getByRole('button', { name: 'Start the visualizer' }).click();
  await expect(page.locator('.immersive canvas')).toBeVisible();
  await expect(page.locator('.immersive .status')).toContainText(/Closest to|Listening/, { timeout: 30000 });
  await page.screenshot({ path: 'test-results/immersive.png' });
  await page.waitForTimeout(3500);
  await expect(page.locator('.immersive .controls')).toHaveClass(/hidden/); // controls fade after 3 s
  await page.mouse.move(200, 200);
  await expect(page.locator('.immersive .controls')).not.toHaveClass(/hidden/);
  await page.getByRole('button', { name: 'Default colors' }).click();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('heading', { name: 'Your palette' })).toBeVisible();
  expect(errors).toEqual([]);
});

/** Count getUserMedia calls and whether the returned tracks are still live. */
async function instrumentMedia(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __media: { calls: string[]; streams: MediaStream[] } };
    w.__media = { calls: [], streams: [] };
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.__media.calls.push(c?.video ? 'camera' : 'mic');
      const s = await orig(c);
      w.__media.streams.push(s);
      return s;
    };
  });
}
const media = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __media: { calls: string[]; streams: MediaStream[] } }).__media;
    const liveTracks = m.streams.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live');
    return { calls: m.calls, live: liveTracks.length, kinds: liveTracks.map((t) => t.kind) };
  });

function seededFingerprint(daysAgo: number) {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const timbres = ['piano', 'sine', 'strings', 'voice'];
  const notes: [string, number][] = [['C3', 48], ['A3', 57], ['F4', 65], ['D5', 74], ['B5', 83]];
  const answers = timbres.flatMap((t) =>
    notes.flatMap(([n]) => [1, 2, 3].map((r) => ({
      stimulusId: `${t}-${n}`, repetition: r,
      color: { hex: '#3b6fb6', luv: [45.6, -15.2, -55.1], oklch: [0.53, 0.12, 255] },
      reactionMs: 900, replays: 0, timestamp: ts,
    }))),
  );
  const anchors: Record<string, Record<number, number[]>> = {};
  for (const t of timbres) anchors[t] = Object.fromEntries(notes.map(([, m]) => [m, [0.53, 0.12, 255]]));
  return {
    schemaVersion: 1, createdAt: ts, sessions: [{ startedAt: ts, answers }], anchors,
    consistency: { overall: 0, perStimulus: {} }, patterns: { pitchLightnessRho: null, timbreHueGaps: {} }, flags: {},
  };
}

test('phase 2: mic and camera only when picked, stopped when left; share card', async ({ page }) => {
  await instrumentMedia(page);
  await page.goto('/');
  await page.evaluate((fp) => localStorage.setItem('colorFingerprint.fingerprint', JSON.stringify(fp)), seededFingerprint(3));
  await page.reload();

  // Share card: palette + title only, 1200 × 630 PNG.
  await page.getByRole('button', { name: 'See your colors' }).click();
  for (let k = 0; k < 3; k++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Save and share' }).click();
  await expect(page.getByRole('img', { name: /Share card/ })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download image' }).click()]);
  const buf = await (await import('node:fs/promises')).readFile((await dl.path())!);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  expect(buf.readUInt32BE(16)).toBe(1200);
  expect(buf.readUInt32BE(20)).toBe(630);
  const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add a reminder to your calendar' }).click()]);
  expect(ics.suggestedFilename()).toMatch(/\.ics$/);

  // Immersive: nothing requested until chosen.
  await page.getByRole('button', { name: 'Back to your colors' }).click();
  for (let k = 0; k < 3; k++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Hear music in your colors' }).click();
  await page.getByLabel(/wearing headphones/).check();
  await page.getByLabel(/moving light and color/).check();
  await page.getByRole('button', { name: 'Play test tone' }).click();
  await page.getByRole('button', { name: 'Play test tone again' }).waitFor();
  await page.getByRole('button', { name: 'Hear music in your colors' }).click();
  await page.getByRole('button', { name: 'Start the visualizer' }).click();
  await expect(page.locator('.immersive canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await media(page)).calls).toEqual([]);

  await page.mouse.move(300, 300);
  await page.getByRole('combobox', { name: 'Music' }).selectOption('mic');
  await expect.poll(async () => (await media(page)).calls).toEqual(['mic']);
  await expect.poll(async () => (await media(page)).live).toBe(1);
  await page.mouse.move(310, 300);
  await page.getByRole('combobox', { name: 'Music' }).selectOption('rain');
  await expect.poll(async () => (await media(page)).live).toBe(0); // mic fully stopped

  await page.mouse.move(320, 300);
  await page.getByRole('combobox', { name: 'View' }).selectOption('projector');
  await expect.poll(async () => (await media(page)).calls).toEqual(['mic', 'camera']);
  await expect.poll(async () => (await media(page)).live).toBe(1);
  await page.mouse.move(330, 300);
  await page.getByRole('combobox', { name: 'View' }).selectOption('associator');
  await expect.poll(async () => (await media(page)).live).toBe(0); // camera fully stopped

  // Switching off while the camera is still starting must not leave it running.
  await page.getByRole('combobox', { name: 'View' }).selectOption('projector');
  await page.getByRole('combobox', { name: 'View' }).selectOption('associator');
  await page.waitForTimeout(1500);
  expect((await media(page)).live).toBe(0);

  await page.getByRole('combobox', { name: 'View' }).selectOption('projector');
  await expect.poll(async () => (await media(page)).live).toBe(1);
  await page.mouse.move(340, 300);
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect.poll(async () => (await media(page)).live).toBe(0); // leaving stops everything
});

test('phase 2: retest compares with the saved fingerprint', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((fp) => localStorage.setItem('colorFingerprint.fingerprint', JSON.stringify(fp)), seededFingerprint(3));
  await page.reload();
  await page.getByRole('button', { name: 'Retest your colors' }).click();
  await setup(page, false);
  for (let i = 0; i < TOTAL; i++) await answer(page);
  await expect(page.getByRole('heading', { name: 'Your palette' })).toBeVisible({ timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('colorFingerprint.fingerprint')!));
  expect(saved.sessions).toHaveLength(2);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Since last time' })).toBeVisible();
  await expect(page.getByText(/3 days ago, your repeat colors were very close/)).toBeVisible();
  await expect(page.getByText(/your average color for each sound moved/)).toBeVisible();
});
