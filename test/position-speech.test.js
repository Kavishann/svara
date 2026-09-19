import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PositionSpeech } from '../src/position-speech.js';
import { Engine } from '../src/core/engine.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture() {
  const launched = [], failures = [];
  const speech = new PositionSpeech({ delay: 1, onFailure: () => failures.push('tone'), launch: (...args) => {
    const child = new EventEmitter(); child.killed = false;
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); };
    launched.push({ args, child }); return child;
  } });
  return { speech, launched, failures };
}

test('navigation speech sends only a validated English number to Apple speech', async () => {
  const { speech, launched } = fixture();
  speech.speak(23); await tick();
  assert.deepEqual(launched[0].args, ['/usr/bin/say', ['-v', 'Samantha', '-r', '230', '23'], { stdio: 'ignore' }]);
  for (const value of ['site title', '2; command', 0, -1, 2.5, 10001, NaN]) speech.speak(value);
  await tick(); assert.equal(launched.length, 1); assert.equal(launched[0].child.killed, true);
});

test('rapid navigation replaces queued and playing numbers; Stop prevents late sound', async () => {
  const { speech, launched, failures } = fixture();
  speech.speak(1); speech.speak(2); speech.speak(3); await tick();
  assert.equal(launched.length, 1); assert.equal(launched[0].args[1].at(-1), '3');
  speech.speak(4); assert.equal(launched[0].child.killed, true); await tick();
  launched[0].child.emit('error', new Error('late error')); assert.deepEqual(failures, []);
  speech.stop(); assert.equal(launched[1].child.killed, true);
  speech.speak(5); speech.stop(); await tick(); assert.equal(launched.length, 2);
});

test('unavailable local speech requests a single fallback tone', async () => {
  const { speech, launched, failures } = fixture();
  speech.speak(1); await tick();
  launched[0].child.emit('error', new Error('unavailable')); launched[0].child.emit('exit', 1, null);
  assert.deepEqual(failures, ['tone']);
});

test('quiet title navigation announces the real position, without translating or reading a title', async () => {
  const settings = { speechEnabled: true, readOnFocus: false, guidanceLanguage: 'si-LK' };
  const snapshot = { pageId: 'one', url: 'https://example.com', title: 'Example', results: Array.from({ length: 3 }, (_, i) => ({ id: String(i), text: `Title ${i + 1}` })) };
  const positions = [], spoken = [];
  const engine = new Engine({ browser: {}, google: { translate: () => { throw new Error('Must not translate numbers'); } }, settings: () => settings });
  engine.on('reader-position', value => positions.push(value.number)); engine.on('narration', value => spoken.push(value));
  await engine.run((epoch, signal) => engine.adoptPage(snapshot, epoch, signal));
  await engine.control('focus_next'); await engine.control('focus_previous');
  assert.deepEqual(positions, [1, 2, 1]); assert.equal(spoken.length, 0);
  await engine.control('repeat'); assert.equal(spoken.at(-1).text, '1. Title 1'); assert.equal(positions.length, 3);
  settings.readOnFocus = true;
  await engine.control('focus_next'); assert.equal(positions.length, 3); assert.equal(spoken.at(-1).text, '2. Title 2');
  settings.readOnFocus = false; settings.speechEnabled = false;
  await engine.control('focus_previous'); assert.equal(positions.length, 3);
  engine.stop();
});

test('installed Apple English voice renders numbers offline', { skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-apple-speech-'));
  try {
    const file = path.join(directory, 'numbers.aiff');
    await promisify(execFile)('/usr/bin/say', ['-v', 'Samantha', '-o', file, '1. 2. 3.'], { timeout: 10000 });
    assert.ok((await stat(file)).size > 2000, 'Apple generated non-empty audio');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
