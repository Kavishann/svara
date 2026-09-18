import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserController } from '../src/browser/browser.js';
import { Engine } from '../src/core/engine.js';

test('real Chromium: practice reading, stable targets, redaction, tabs and stale-page rejection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-browser-'));
  const browser = new BrowserController({ directory, headless: true });
  try {
    const snapshot = await browser.startPractice();
    assert.equal(snapshot.results.length, 5);
    assert.equal(snapshot.results[2].language, 'si');
    assert.equal(JSON.stringify(snapshot).includes('never-share-this'), false);
    assert.equal(snapshot.elements.some(e => e.type === 'password'), false);
    assert.ok(snapshot.headings.length >= 6); assert.ok(snapshot.article.length >= 5);
    const second = snapshot.results[1];
    await browser.activate(second, snapshot);
    assert.match((await browser.page()).url(), /#music$/);
    await assert.rejects(() => browser.activate(snapshot.results[0], snapshot), /page changed/);
    await browser.startPractice();
    const before = await browser.snapshot();
    await (await browser.page()).locator('[data-practice-result] a').first().evaluate(el => el.textContent = 'A completely different link');
    await assert.rejects(() => browser.activate(before.results[0], before), /changed or disappeared/);
    await browser.execute('new_tab'); assert.equal((await browser.tabs()).length, 2);
    await browser.execute('previous_tab'); assert.match((await browser.page()).url(), /practice/);
    await browser.execute('close_tab'); assert.equal((await browser.tabs()).length, 1);
    const engine = new Engine({ browser, google: {}, jev: {}, settings: () => ({ guidanceLanguage: 'en-US' }) });
    await engine.start(true); await engine.input('next'); assert.equal(engine.reader.index, 1);
    await engine.input('previous'); assert.equal(engine.reader.index, 0);
    await engine.input('read page'); assert.equal(engine.reader.scope, 'article');
    await engine.input('read results'); assert.equal(engine.reader.items.length, 5);
    const page = await browser.page();
    const updated = await browser.snapshot();
    const field = updated.elements.find(e => e.text === 'Practice note');
    await browser.activate(field, updated, 'සිංහල සටහන');
    assert.equal(await page.locator('#note').inputValue(), 'සිංහල සටහන');
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
