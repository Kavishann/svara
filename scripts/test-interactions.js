import assert from 'node:assert/strict';

// Run only in the disposable Electron test profile. Fake audio keeps the user's
// microphone and paid providers out of this UI regression test.
export async function testInteractions(app, window) {
  const initial = await window.evaluate(() => window.svara.initial());
  await app.evaluate(({ ipcMain, BrowserWindow }, state) => {
    globalThis.svaraInteractionTest = { submissions: 0, synthesized: [], spoken: [], positions: 0 };
    ipcMain.removeHandler('speak-position');
    ipcMain.handle('speak-position', () => { globalThis.svaraInteractionTest.positions++; return { ok: true }; });
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
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('reader-position', { number: 2, epoch: 0 }));
  await window.evaluate(() => window.svara.initial());
  assert.equal(await app.evaluate(() => globalThis.svaraInteractionTest.positions), 0, 'No number speech while the microphone is recording');
  await phase('speak-start'); assert.equal(await submissions(), 0);
  assert.equal(await window.evaluate(() => window.svaraFakeMedia.starts), 1);
  await phase('speak-end');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Hold to speak');
  await expectSubmissions(1);
  await phase('speak-start');
  await window.waitForFunction(() => document.querySelector('#talk-label').textContent === 'Release to send');
  await phase('stop'); await phase('speak-end');
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
    globalThis.svaraStreamTest = { manual: false, jobs: new Map(), waiting: [], cancelled: 0 };
    ipcMain.removeHandler('speech-stream');
    ipcMain.handle('speech-stream', async (_event, request) => {
      globalThis.svaraInteractionTest.synthesized.push(request.text);
      globalThis.svaraInteractionTest.spoken.push(request.text);
      return new Promise(resolve => {
        const sendChunk = () => contents.send('speech-chunk', { id: request.id, chunk: new Uint8Array(480) });
        const finish = () => { globalThis.svaraStreamTest.jobs.delete(request.id); resolve({ ok: true, value: { completed: true } }); };
        globalThis.svaraStreamTest.jobs.set(request.id, () => resolve({ ok: true, value: { completed: false } }));
        sendChunk();
        if (globalThis.svaraStreamTest.manual) globalThis.svaraStreamTest.waiting.push(() => { sendChunk(); finish(); });
        else setTimeout(() => { sendChunk(); finish(); }, 40);
      });
    });
    ipcMain.removeHandler('speech-stream-stop');
    ipcMain.handle('speech-stream-stop', (_event, id) => {
      const cancel = globalThis.svaraStreamTest.jobs.get(id);
      if (cancel) { globalThis.svaraStreamTest.cancelled++; globalThis.svaraStreamTest.jobs.delete(id); cancel(); }
      return { ok: true };
    });
  });
  await window.evaluate(() => {
    window.svaraFakePlayback = { automatic: true, waiting: [], started: 0, stopped: 0 };
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      createBufferSource() {
        return { playbackRate: {}, connect() {}, disconnect() {},
          start() {
            window.svaraFakePlayback.started++;
            const done = () => this.onended?.();
            if (window.svaraFakePlayback.automatic) setTimeout(done, 10);
            else window.svaraFakePlayback.waiting.push(done);
          },
          stop() { window.svaraFakePlayback.stopped++; }
        };
      }
    };
  });
  await window.getByRole('button', { name: /^Page reader/ }).click();
  await window.getByRole('button', { name: 'Headings', exact: true }).click();
  await window.waitForFunction(() => document.querySelector('#speaking-indicator').hidden && document.querySelectorAll('.item-button').length > 5);
  await window.locator('#read-on-focus').uncheck();
  await window.waitForFunction(async () => (await window.svara.initial()).settings.readOnFocus === false);
  await app.evaluate(() => { globalThis.svaraInteractionTest.synthesized = []; globalThis.svaraInteractionTest.spoken = []; });
  await window.locator('.item-button').first().focus();
  await window.keyboard.press('ArrowDown');
  await window.waitForFunction(() => document.activeElement?.dataset.itemIndex === '1');
  assert.equal((await app.evaluate(() => globalThis.svaraInteractionTest.synthesized)).length, 0);
  await phase('read');
  await window.waitForFunction(() => document.querySelector('#status-message').textContent.startsWith('2.') && document.querySelector('#speaking-indicator').hidden);
  assert.equal((await app.evaluate(() => globalThis.svaraInteractionTest.spoken)).length, 1);
  assert.equal((await app.evaluate(() => globalThis.svaraInteractionTest.synthesized)).length, 0, 'English selected reading stays on the Mac');
  await app.evaluate(() => { globalThis.svaraInteractionTest.synthesized = []; globalThis.svaraInteractionTest.spoken = []; });
  await window.locator('#continuous').check();
  await window.locator('#read-first-five').click();
  await window.waitForFunction(() => document.querySelector('#position').textContent.startsWith('5 /') && document.querySelector('#speaking-indicator').hidden);
  const spoken = await app.evaluate(() => globalThis.svaraInteractionTest.spoken);
  assert.equal(spoken.length, 5);
  assert.deepEqual(spoken.map(text => Number(text.match(/^\d+/)[0])), [1, 2, 3, 4, 5]);
  await window.evaluate(() => { window.svaraFakePlayback.automatic = false; });
  await app.evaluate(() => { globalThis.svaraPositionTest.manual = true; });
  await app.evaluate(() => { globalThis.svaraInteractionTest.synthesized = []; globalThis.svaraInteractionTest.spoken = []; });
  await window.locator('#read-first-five').click();
  await window.waitForFunction(() => !document.querySelector('#speaking-indicator').hidden);
  await window.locator('#stop-all').click();
  await window.evaluate(() => { window.svaraFakePlayback.waiting.forEach(done => done()); });
  assert.equal((await app.evaluate(() => globalThis.svaraInteractionTest.spoken)).length, 1);
  assert.match(await window.locator('#position').textContent(), /^1 \//);
  // The first cloud chunk must start playback while the provider is still open.
  await window.locator('#continuous').uncheck();
  await window.evaluate(() => { window.svaraFakePlayback.started = 0; window.svaraFakePlayback.stopped = 0; });
  await app.evaluate(() => { globalThis.svaraStreamTest.manual = true; });
  await window.evaluate(() => window.svara.control('help'));
  await window.waitForFunction(() => window.svaraFakePlayback.started === 1);
  assert.equal(await app.evaluate(() => globalThis.svaraStreamTest.jobs.size), 1, 'Playback begins before synthesis completes');
  await window.locator('#stop-all').click();
  await window.waitForFunction(() => document.querySelector('#speaking-indicator').hidden);
  assert.equal(await window.evaluate(() => window.svaraFakePlayback.stopped), 1);
  assert.ok(await app.evaluate(() => globalThis.svaraStreamTest.cancelled) > 0);
  await app.evaluate(() => { globalThis.svaraStreamTest.waiting.forEach(done => done()); });
  await window.evaluate(() => { window.svaraFakePlayback.waiting.forEach(done => done()); });
  assert.equal(await window.evaluate(() => window.svaraFakePlayback.started), 1, 'Late chunks after Stop cannot play');
  assert.match(await window.locator('#position').textContent(), /^1 \//);
  console.log('Hold/release, repeat suppression, five-item playback cap, streaming before completion, and immediate cancellation passed with simulated audio.');
  // Check the renderer-to-main media shortcut route after the other controls.
  await app.evaluate(({ ipcMain }, state) => {
    globalThis.svaraMediaActions = [];
    ipcMain.removeHandler('control');
    ipcMain.handle('control', (_event, action) => {
      globalThis.svaraMediaActions.push(action);
      return { ok: true, value: state };
    });
  }, initial.state);
  await phase('media_toggle');
  await window.waitForFunction(() => document.querySelector('#status-message').textContent.length > 0);
  await app.evaluate(async () => {
    const deadline = Date.now() + 2000;
    while (!globalThis.svaraMediaActions.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.deepEqual(await app.evaluate(() => globalThis.svaraMediaActions), ['media_toggle']);
}
