import { expect, test, type Page } from '@playwright/test';

const HUE: Record<string, number> = { piano: 250, sine: 140, strings: 30 };
const LIGHT: Record<string, number> = { C3: 30, A3: 42, F4: 55, D5: 68, B5: 82 };

async function setup(page: Page) {
  await page.getByRole('button', { name: /Find your colors|Continue finding your colors/ }).click();
  const tone = page.getByRole('button', { name: 'Play test tone' });
  await expect(tone).toBeDisabled(); // no sound before confirmations
  await expect(page.getByRole('button', { name: 'Start listening' })).toBeDisabled();
  await page.getByLabel(/wearing headphones/).check();
  await page.getByLabel(/moving light and color/).check();
  await tone.click();
  await expect(page.getByRole('button', { name: 'Play test tone again' })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Start listening' }).click();
}

async function answer(page: Page) {
  const trial = page.locator('[data-stimulus]');
  await expect(trial).toBeVisible({ timeout: 15000 });
  const id = (await trial.getAttribute('data-stimulus'))!;
  const [timbre, note] = id.split('-');
  await expect(page.getByRole('button', { name: /Playing|Play again/ })).toBeVisible();
  await page.getByLabel('Hue', { exact: true }).fill(String(HUE[timbre]));
  await page.getByLabel('Lightness', { exact: true }).fill(String(LIGHT[note]));
  await page.getByLabel('Colorfulness', { exact: true }).fill('12');
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toBeEnabled({ timeout: 5000 });
  await next.click();
  return id;
}

test('full flow: setup, 45 trials with resume after reload, results, immersive', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What does music look like to you?' })).toBeVisible();
  await setup(page);

  for (let i = 0; i < 5; i++) await answer(page);
  await expect(page.getByText('Sound 6 of 45')).toBeVisible();

  // Pause, reload, resume where we left off.
  await page.reload();
  await setup(page);
  await expect(page.getByText('Sound 6 of 45')).toBeVisible();

  const seen: string[] = [];
  for (let i = 5; i < 45; i++) {
    const id = await answer(page);
    if (seen.length) expect(id).not.toBe(seen[seen.length - 1]);
    seen.push(id);
  }

  await expect(page.getByRole('heading', { name: 'Your palette' })).toBeVisible({ timeout: 10000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('colorFingerprint.fingerprint')!));
  const answers = saved.sessions[0].answers;
  expect(answers).toHaveLength(45);
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
