import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.GOMOKU_BROWSER_PATH ? { executablePath: process.env.GOMOKU_BROWSER_PATH } : {}) });
const base = process.env.GOMOKU_TEST_URL || 'http://127.0.0.1:4173';
const errors = [];
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
const artifact = name => fileURLToPath(new URL(`../artifacts/${name}`, import.meta.url));
const count = (p, n) => p.waitForFunction(expected => document.getElementById('history-count').textContent === `${expected} 手`, n);
const ready = p => p.waitForFunction(() => document.getElementById('analysis-status').textContent.includes('实时'));
async function localGame(p) {
  await p.locator('#new-game').click(); await p.locator('label:has(input[name="mode"][value="local"])').click();
  await p.locator('#settings-form button[type="submit"]').click();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await ready(page); await localGame(page);
  assert.equal(await page.locator('#board').evaluate(n => n.tagName), 'DIV');
  assert.equal(await page.locator('#board button[role="gridcell"]').count(), 361);
  for (const i of [180, 181, 161, 179, 162, 142, 163, 182, 200, 201, 145, 126]) await page.locator(`[data-index="${i}"]`).click();
  await count(page, 12); await ready(page);
  await page.locator('#toggle-numbers').click();
  assert.ok(await page.locator('#board').evaluate(n => n.classList.contains('show-numbers')));
  assert.equal(await page.locator('[data-index="180"] .stone-piece').textContent(), '1');
  await page.locator('#toggle-coordinates').click();
  assert.equal(await page.locator('.coordinates-top').evaluate(n => getComputedStyle(n).visibility), 'hidden');
  await page.locator('#toggle-coordinates').click();
  await page.locator('#zoom-board').click();
  assert.ok(await page.locator('#board-viewport').evaluate(n => n.scrollWidth > n.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#zoom-board').click();
  await page.locator('#focus-board').click(); assert.ok(await page.locator('body').evaluate(n => n.classList.contains('focus-mode')));
  assert.equal(await page.locator('.sidebar').isVisible(), false); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sidebar').isVisible(), true);
  await page.reload(); await ready(page); await count(page, 12);
  assert.equal(await page.locator('#toggle-numbers').getAttribute('aria-pressed'), 'true');
  const box = await page.locator('[data-index="180"]').boundingBox(); assert.ok(Math.abs(box.width - box.height) < 1);
  await page.locator('[data-index="170"]').hover(); assert.ok((await page.locator('#point-readout').textContent()).includes('T11'));
  await page.waitForTimeout(3100); await page.mouse.move(0, 0);
  await page.screenshot({ path: artifact('optimized-desktop.png'), fullPage: true });
  console.log('PASS: native HTML grid, move numbers/persistence, coordinates, scrollable zoom, focus/Escape, square cells');

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touch = await touchContext.newPage(); touch.on('pageerror', e => errors.push(e.message));
  await touch.goto(base); await ready(touch); await localGame(touch);
  await touch.locator('[data-index="180"]').tap(); await count(touch, 0);
  assert.equal(await touch.locator('#placement-confirm').isVisible(), true);
  assert.equal(await touch.locator('#selected-point').textContent(), 'K10');
  await touch.locator('[data-index="181"]').tap(); assert.equal(await touch.locator('#selected-point').textContent(), 'L10');
  await touch.locator('#cancel-placement').tap(); assert.equal(await touch.locator('#placement-confirm').isVisible(), false); await count(touch, 0);
  await touch.locator('[data-index="180"]').tap(); await touch.locator('#confirm-placement').tap(); await count(touch, 1);
  await touch.locator('#toggle-touch').tap(); await touch.locator('[data-index="181"]').tap(); await count(touch, 2);
  assert.equal(await touch.locator('#placement-confirm').isVisible(), false);
  await touch.locator('#zoom-board').tap(); assert.ok(await touch.locator('#board-viewport').evaluate(n => n.scrollWidth > n.clientWidth));
  assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await touch.locator('#zoom-board').tap();
  await touch.locator('#toggle-touch').tap(); await touch.locator('[data-index="161"]').tap();
  await touch.waitForTimeout(3100); await touch.screenshot({ path: artifact('optimized-mobile.png'), fullPage: true });
  await touch.locator('#confirm-placement').tap(); await count(touch, 3);
  // Restore a fresh page at the narrowest supported width, with no horizontal overflow.
  await touch.setViewportSize({ width: 320, height: 700 });
  assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('PASS: touch preselection/change/cancel/confirm, direct-tap option, mobile zoom and 320px layout');

  const fileContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await fileContext.setOffline(true);
  const file = await fileContext.newPage(); file.on('pageerror', e => errors.push(e.message));
  const networkRequests = []; file.on('request', r => { if (/^https?:/.test(r.url())) networkRequests.push(r.url()); });
  await file.goto(pathToFileURL(fileURLToPath(new URL('../弈间-五子棋.html', import.meta.url))).href); await ready(file);
  assert.equal(await file.locator('[role="gridcell"]').count(), 361);
  await file.locator('[data-index="180"]').click(); await count(file, 2);
  await file.locator('#undo-button').click(); await count(file, 0);
  await localGame(file); await file.locator('[data-index="180"]').click(); await count(file, 1);
  await file.reload(); await count(file, 1); await ready(file);
  assert.deepEqual(networkRequests, []);
  console.log('PASS: standalone file:// HTML offline AI, undo, local mode and refresh persistence, zero HTTP dependencies');
  if (process.env.GOMOKU_ONLINE_TEST === '1') {
    await fileContext.setOffline(false); await file.locator('#invite-button').click(); await file.locator('#create-room').click();
    await file.waitForFunction(() => document.getElementById('invite-link').value.includes('?room='));
    const invite = await file.locator('#invite-link').inputValue(); assert.ok(invite.startsWith('https://yangc1222.github.io/-/?room='));
    const guest = await (await browser.newContext()).newPage(); guest.on('pageerror', e => errors.push(e.message)); await guest.goto(invite);
    await file.waitForFunction(() => document.getElementById('online-strip').classList.contains('connected'));
    await guest.waitForFunction(() => document.getElementById('online-strip').classList.contains('connected'));
    await file.locator('#room-close').click(); await guest.locator('#room-close').click();
    await file.locator('[data-index="180"]').click(); await count(guest, 1);
    await guest.locator('[data-index="181"]').click(); await count(file, 2);
    console.log('PASS: standalone local-file host invites a guest via the deployed HTTPS site; both moves synchronized');
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
