import assert from 'node:assert/strict';

// Run only in the disposable Electron test profile. Fake audio keeps the user's
// microphone and paid providers out of this UI regression test.
export async function testInteractions(app, window) {
  const initial = await window.evaluate(() => window.svara.initial());
  await app.evaluate(({ ipcMain, BrowserWindow }, state) => {
    globalThis.svaraInteractionTest = { submissions: 0, synthesized: [] };
    ipcMain.removeHandler('microphone-permission');
    ipcMain.handle('microphone-permission', () => ({ ok: true, value: true }));
    ipcMain.removeHandler('audio');
    ipcMain.handle('audio', (_event, bytes) => {
      if (bytes.length < 1000) throw new Error('Missing recorded audio');
      globalThis.svaraInteractionTest.submissions++;
      return { ok: true, value: { ...state, practice: false } };
    });
    const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents);
    contents.send = (channel, data) => send(channel, channel === 'state' ? { ...data, practice: false } : data);
    contents.send('state', state);
  }, initial.state);
  await window.evaluate(() => {
    window.svaraFakeMedia = { starts: 0, stoppedTracks: 0 };
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop: () => window.svaraFakeMedia.stoppedTracks++ }] });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(_stream, { mimeType }) { this.mimeType = mimeType; this.state = 'inactive'; }
      start() { this.state = 'recording'; window.svaraFakeMedia.starts++; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => { this.ondataavailable({ data: new Blob(['x'.repeat(1800)]) }); this.onstop(); });
      }
    };
  });
  const phase = async action => app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('shortcut-action', value), action);
  const submissions = () => app.evaluate(() => globalThis.svaraInteractionTest.submissions);
  const expectSubmissions = async expected => {
    const result = await app.evaluate(async (_electron, count) => {
      const deadline = Date.now() + 1500;
      while (globalThis.svaraInteractionTest.submissions < count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      return globalThis.svaraInteractionTest.submissions;
    }, expected);
    assert.equal(result, expected);
  };
  await phase('speak-start');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Release to send');
  await phase('speak-start'); assert.equal(await submissions(), 0);
  assert.equal(await window.evaluate(() => window.svaraFakeMedia.starts), 1);
  await phase('speak-end');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Hold to speak');
  await expectSubmissions(1);
  await phase('speak-start');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Release to send');
  await window.keyboard.press('Escape'); await phase('speak-end');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Hold to speak');
  await expectSubmissions(1);

  // Both mouse and keyboard release work on the visible speaking button.
  // Flush Escape's response, whose real practice state can arrive after the
  // test's mocked state event, then restore the simulated live microphone mode.
  await window.evaluate(() => window.svara.control('stop'));
  await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('state', state), initial.state);
  await window.waitForFunction(() => document.querySelector('#mode-pill').textContent === 'Live browsing');
  const talk = window.locator('#talk'); await window.bringToFront(); await talk.focus();
  await window.keyboard.down('Space');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Release to send');
  await window.keyboard.up('Space');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Hold to speak');
  await expectSubmissions(2);
  const box = await talk.boundingBox(); await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.down();
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Release to send');
  await window.mouse.up();
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Hold to speak');
  await expectSubmissions(3);

  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents, send = contents.send.bind(contents);
    contents.send = (channel, data) => send(channel, channel === 'narration' ? { ...data, practice: false } : data);
    ipcMain.removeHandler('synthesize');
    ipcMain.handle('synthesize', (_event, request) => {
      globalThis.svaraInteractionTest.synthesized.push(request.text);
      return { ok: true, value: 'AA==' };
    });
  });
  await window.evaluate(() => {
    window.svaraFakePlayback = { automatic: true, waiting: [] };
    window.Audio = class {
      async play() {
        const done = () => this.onended?.();
        if (window.svaraFakePlayback.automatic) setTimeout(done, 10);
        else window.svaraFakePlayback.waiting.push(done);
      }
      pause() {}
    };
  });
  await window.getByRole('button', { name: /^Page reader/ }).click();
  await window.getByRole('button', { name: 'Headings', exact: true }).click();
  await window.waitForFunction(() => document.querySelector('#speaking-indicator').hidden && document.querySelectorAll('.item-button').length > 5);
  await app.evaluate(() => { globalThis.svaraInteractionTest.synthesized = []; });
  await window.locator('#continuous').check();
  await window.locator('#read-first-five').click();
  await window.waitForFunction(() => document.querySelector('#position').textContent.startsWith('5 /') && document.querySelector('#speaking-indicator').hidden);
  const spoken = await app.evaluate(() => globalThis.svaraInteractionTest.synthesized);
  assert.equal(spoken.length, 5);
  assert.deepEqual(spoken.map(text => Number(text.match(/^\d+/)[0])), [1, 2, 3, 4, 5]);
  await window.evaluate(() => { window.svaraFakePlayback.automatic = false; });
  await app.evaluate(() => { globalThis.svaraInteractionTest.synthesized = []; });
  await window.locator('#read-first-five').click();
  await window.waitForFunction(() => !document.querySelector('#speaking-indicator').hidden);
  await window.locator('#stop-all').click();
  await window.evaluate(() => { window.svaraFakePlayback.waiting.forEach(done => done()); });
  assert.equal((await app.evaluate(() => globalThis.svaraInteractionTest.synthesized)).length, 1);
  assert.match(await window.locator('#position').textContent(), /^1 \//);
  console.log('Hold/release, repeat suppression, Escape, button keyboard/mouse release, five-item playback cap with continuous enabled, and playback interruption passed with simulated audio.');
}
