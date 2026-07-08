import { test, expect } from '@playwright/test';

/**
 * End-to-end smoke tests for the editor.
 *
 * Each test boots the app fresh; the helpers below dismiss the first-visit
 * welcome dialog and load the bundled sample track through the real UI.
 */

async function bootApp(page) {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0);

  // Dismiss the welcome dialog if it appeared (always shows on first visit).
  await page.waitForTimeout(600);
  const cancel = page.locator('.pk_modal_cancel');
  if (await cancel.count()) {
    await cancel.first().click();
  }

  return consoleErrors;
}

async function loadSample(page) {
  await page.getByText('here to use a sample').first().click();
  await page.waitForFunction(() => window.PKAudioEditor.engine.is_ready, null, {
    timeout: 20_000,
  });
}

test('boots the editor and exposes the global bridge', async ({ page }) => {
  const consoleErrors = await bootApp(page);

  await expect(page.getByText('File').first()).toBeVisible();
  expect(await page.evaluate(() => !!window.PKAudioEditor?.engine?.wavesurfer)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('loads the sample track and plays it', async ({ page }) => {
  const consoleErrors = await bootApp(page);
  await loadSample(page);

  const duration = await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.getDuration());
  expect(duration).toBeGreaterThan(1);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestPlay'));
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.isPlaying())).toBe(true);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestPause'));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.isPlaying())).toBe(false);

  expect(consoleErrors).toEqual([]);
});

test('cut, paste and undo modify the buffer correctly', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  const duration = () => page.evaluate(() => window.PKAudioEditor.engine.wavesurfer.getDuration());

  const before = await duration();

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestSelect', false, [1.0, 2.0]));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionCut', 1));
  await page.waitForTimeout(800);
  expect(await duration()).toBeLessThan(before);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestActionPaste'));
  await page.waitForTimeout(800);
  expect(Math.abs((await duration()) - before)).toBeLessThan(0.05);

  // Undo the paste: the undo stack must shrink through the event bus.
  const undoLength = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.PKAudioEditor.listenFor('DidStateChange', (undo) => resolve(undo.length));
        window.PKAudioEditor.fireEvent('StateRequestUndo');
      })
  );
  expect(undoLength).toBeLessThanOrEqual(1);
});

test('applies an effect and records it in the undo history', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  await page.evaluate(() => window.PKAudioEditor.fireEvent('RequestSelect'));
  await page.waitForTimeout(300);

  const undoLength = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.PKAudioEditor.listenFor('DidStateChange', (undo) => resolve(undo.length));
        window.PKAudioEditor.fireEvent('RequestActionFX_Normalize', [false, 1.0]);
      })
  );
  expect(undoLength).toBe(1);
});

test('effect dialogs open and close', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  for (const event of ['RequestFXUI_Gain', 'RequestActionFXUI_ParaGraphicEQ']) {
    await page.evaluate((name) => window.PKAudioEditor.fireEvent(name), event);
    await expect(page.locator('.pk_modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pk_modal')).toHaveCount(0);
  }
});

test('export dialog opens with format options', async ({ page }) => {
  await bootApp(page);
  await loadSample(page);

  await page.evaluate(() => document.querySelector('.pk_opt[data-id="dl"]').click());
  await expect(page.locator('.pk_modal')).toBeVisible();
  await expect(page.locator('.pk_modal input[value="mp3"]')).toHaveCount(1);
  await expect(page.locator('.pk_modal input[value="flac"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
});
