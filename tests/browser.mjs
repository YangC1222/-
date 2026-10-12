// Optional integration check: needs Playwright and an installed Chromium/Edge browser.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.GOMOKU_BROWSER_PATH ? { executablePath: process.env.GOMOKU_BROWSER_PATH } : {}) });
const base = process.env.GOMOKU_TEST_URL || 'http://127.0.0.1:4173';
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1150 } });
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const clickCell = (p, index) => p.locator(`[data-index="${index}"]`).click();
const waitCount = (p, count) => p.waitForFunction(n => document.getElementById('history-count').textContent === `${n} 手`, count);
async function newLocal() {
  await page.locator('#new-game').click();
  await page.locator('label:has(input[name="mode"][value="local"])').click();
  await page.locator('#settings-form button[type="submit"]').click();
}
try {
  await page.goto(base); await page.waitForFunction(() => document.getElementById('analysis-status').textContent.includes('实时'));
  assert.equal(await page.locator('[role="gridcell"]').count(), 361);
  await clickCell(page, 180); await waitCount(page, 2);
  await page.locator('#undo-button').click(); await waitCount(page, 0);
  await page.waitForTimeout(600); assert.equal(await page.locator('#history-count').textContent(), '0 手');
  // Cancelling an AI worker/timer must not leave a ghost move behind.
  await clickCell(page, 160); await page.locator('#undo-button').click(); await waitCount(page, 0);
  await page.waitForTimeout(1200); assert.equal(await page.locator('#history-count').textContent(), '0 手');
  await newLocal();
  for (const i of [180, 0, 181, 2, 182, 4, 183, 6, 184]) await clickCell(page, i);
  assert.ok((await page.locator('#game-status').textContent()).includes('获胜'));
  assert.equal(await page.locator('.winning-mark').count(), 5);
  await page.locator('#undo-button').click(); assert.equal(await page.locator('.winning-mark').count(), 0); await waitCount(page, 8);
  await page.locator('#resign-button').click(); await page.locator('#confirm-ok').click();
  assert.ok((await page.locator('#game-status').textContent()).includes('认输'));
  await page.reload(); assert.ok((await page.locator('#game-status').textContent()).includes('认输')); await waitCount(page, 8);
  const download = page.waitForEvent('download'); await page.locator('#export-button').click(); assert.ok((await download).suggestedFilename().endsWith('.txt'));
  await newLocal();
  const cell = page.locator('[data-index="180"]'); await cell.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await waitCount(page, 1);
  assert.ok((await page.locator('[data-index="181"]').getAttribute('aria-label')).includes('黑棋'));
  await page.locator('#rules-button').click(); assert.ok(await page.locator('#rules-dialog').isVisible()); await page.keyboard.press('Escape');
  await page.screenshot({ path: fileURLToPath(new URL('../artifacts/desktop.png', import.meta.url)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: fileURLToPath(new URL('../artifacts/mobile.png', import.meta.url)), fullPage: true });
  console.log('PASS: AI play/undo/cancellation, local win, resignation, persistence, download, keyboard, mobile overflow');
  if (process.env.GOMOKU_ONLINE_TEST === '1') {
    await page.setViewportSize({ width: 1440, height: 1150 });
    await page.locator('#invite-button').click(); await page.locator('#create-room').click();
    await page.waitForFunction(() => document.getElementById('invite-link').value.includes('room='), { timeout: 30000 });
    const link = await page.locator('#invite-link').inputValue(); console.log('Public signaling: room created');
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 1150 } });
    const guest = await guestContext.newPage(); guest.on('pageerror', e => errors.push(e.message));
    await guest.goto(link);
    await page.waitForFunction(() => document.getElementById('online-strip').classList.contains('connected'), { timeout: 30000 });
    await guest.waitForFunction(() => document.getElementById('online-strip').classList.contains('connected'), { timeout: 30000 });
    await page.locator('#room-close').click(); await guest.locator('#room-close').click();
    assert.equal(await guest.locator('[data-index="180"]').getAttribute('aria-disabled'), 'true');
    await guest.locator('[data-index="180"]').click({ force: true }); await waitCount(guest, 0);
    await clickCell(page, 180); await waitCount(page, 1); await waitCount(guest, 1);
    await clickCell(guest, 181); await waitCount(page, 2); await waitCount(guest, 2);
    await page.locator('#undo-button').click(); await guest.locator('#request-decline').click(); await waitCount(page, 2);
    await page.waitForFunction(() => !document.getElementById('undo-button').disabled);
    await page.locator('#undo-button').click(); await guest.locator('#request-accept').click(); await waitCount(page, 0); await waitCount(guest, 0);
    for (const [i, index] of [180, 0, 181, 2, 182, 4, 183, 6, 184].entries()) {
      await clickCell(i % 2 ? guest : page, index); await waitCount(page, i + 1); await waitCount(guest, i + 1);
    }
    assert.ok((await page.locator('#game-status').textContent()).includes('获胜')); assert.ok((await guest.locator('#game-status').textContent()).includes('获胜'));
    await page.screenshot({ path: fileURLToPath(new URL('../artifacts/online-desktop.png', import.meta.url)), fullPage: true });
    await page.locator('#new-game').click(); await guest.locator('#request-accept').click(); await waitCount(page, 0); await waitCount(guest, 0);
    await guest.locator('#resign-button').click(); await guest.locator('#confirm-ok').click();
    await page.waitForFunction(() => document.getElementById('game-status').textContent.includes('认输'));
    assert.ok((await guest.locator('#game-status').textContent()).includes('认输'));
    await guest.reload(); await guest.waitForFunction(() => document.getElementById('online-strip').classList.contains('connected'), { timeout: 30000 });
    assert.ok((await guest.locator('#game-status').textContent()).includes('认输'));
    await guest.close(); await page.waitForFunction(() => document.getElementById('online-message').textContent.includes('断线'));
    console.log('PASS: actual public-signaling WebRTC invitation, turn enforcement, synchronized moves/win/resign, undo reject/accept, mutual restart, guest reload/reconnect, disconnect pause');
  }
  console.log(JSON.stringify({ errors }));
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
