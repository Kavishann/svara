import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserController } from '../src/browser/browser.js';

test('extension content reads AJAX titles, verifies stale targets, and fills Sinhala without exposing secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-content-'));
  const browser = new BrowserController({ directory, headless: true });
  try {
    const page = await browser.page();
    await page.route('https://example.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Reader fixture</h1><h3><a href="/one">First title</a></h3><label>Note<input id="note"></label><input id="password" type="password" value="secret-value"></main>' }));
    await page.goto('https://example.test/');
    await page.evaluate(() => {
      globalThis.chrome = { runtime: { id: 'test', onMessage: { addListener(callback) { globalThis.fixtureListener = callback; } }, sendMessage: async () => {} } };
      globalThis.fixtureCommand = message => new Promise(resolve => globalThis.fixtureListener({ type: 'svara', ...message }, { id: 'test' }, resolve));
    });
    await page.addScriptTag({ path: 'build/chrome-extension/collector.js' });
    await page.addScriptTag({ path: 'build/chrome-extension/content.js' });
    const command = message => page.evaluate(message => globalThis.fixtureCommand(message), message);
    const first = await command({ action: 'snapshot' }); assert.equal(first.ok, true);
    assert.equal(JSON.stringify(first).includes('secret-value'), false);
    const target = first.value.elements.find(item => item.text === 'Note');
    const filled = await command({ action: 'activate', snapshot: first.value, target, text: 'සිංහල සටහන' });
    assert.equal(filled.ok, true); assert.equal(await page.locator('#note').inputValue(), 'සිංහල සටහන');
    const link = first.value.elements.find(item => item.text === 'First title');
    await page.locator('a').evaluate(el => { el.textContent = 'Changed title'; });
    const stale = await command({ action: 'activate', target: link, snapshot: first.value }); assert.equal(stale.ok, false); assert.match(stale.error, /changed/);
    await page.locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<h3><a href="/two">Second title</a></h3>'));
    const fresh = await command({ action: 'snapshot' }); assert.ok(fresh.value.links.some(item => item.text === 'Second title'));
    const malicious = await command({ action: 'shell' }); assert.equal(malicious.ok, false);
    const wrongSender = await page.evaluate(() => globalThis.fixtureListener({ type: 'svara', action: 'snapshot' }, { id: 'another-extension' }, () => { throw new Error('Unexpected response'); })); assert.equal(wrongSender, undefined);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
