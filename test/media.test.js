import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserController } from '../src/browser/browser.js';
import { Engine } from '../src/core/engine.js';

test('media key pauses playing elements and resumes only those elements without cloud calls', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-media-'));
  const browser = new BrowserController({ directory, headless: true });
  try {
    await browser.startPractice();
    const page = await browser.page();
    await page.goto('about:blank');
    // Silent PCM exercises actual Chromium media playback, including an empty
    // placeholder before the playing elements and an unrelated paused player.
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    await page.setContent('<title>Media fixture</title><video id="empty"></video><audio id="idle"></audio><audio id="music"></audio><video id="video"></video>');
    await page.evaluate(async src => {
      for (const id of ['idle', 'music', 'video']) {
        const media = document.getElementById(id);
        media.src = src; media.loop = true; media.muted = true;
        if (id !== 'idle') await media.play();
      }
    }, `data:audio/wav;base64,${wav.toString('base64')}`);
    const states = () => page.evaluate(() => ['idle', 'music', 'video'].map(id => document.getElementById(id).paused));
    assert.deepEqual(await states(), [true, false, false]);
    const engine = new Engine({ browser, google: {}, jev: {}, settings: () => ({ guidanceLanguage: 'si-LK', readOnFocus: false }) });
    const narrations = [];
    engine.on('narration', item => narrations.push(item));
    await engine.control('media_toggle');
    assert.deepEqual(await states(), [true, true, true]);
    assert.equal(engine.message, 'Media paused.');
    await engine.control('media_toggle');
    assert.deepEqual(await states(), [true, false, false]);
    assert.equal(engine.message, 'Media playing.');
    assert.ok(narrations.every(item => item.language === 'en-US'));
    await engine.control('stop');
    assert.deepEqual(await states(), [true, false, false], 'Stop voice leaves page media alone');
    await engine.control('pause');
    await engine.control('pause');
    await engine.control('play');
    assert.deepEqual(await states(), [true, false, false], 'Repeated Pause preserves the resume group');
    await browser.execute('pause');
    await page.locator('#video').evaluate(media => media.remove());
    await browser.execute('media_toggle');
    assert.equal(await page.locator('#music').evaluate(media => media.paused), false);
    assert.equal(await page.locator('#idle').evaluate(media => media.paused), true);
    const other = await browser.context.newPage();
    await other.goto('about:blank');
    await assert.rejects(() => browser.execute('media_toggle'), /no playable/);
    assert.equal(await page.locator('#music').evaluate(media => media.paused), false, 'A media key on another tab does not pause this one');
    await other.close();
    await page.goto('about:blank');
    await assert.rejects(() => browser.execute('media_toggle'), /no playable/);
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});
