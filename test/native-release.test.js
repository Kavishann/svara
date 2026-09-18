import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createReleaseWatcher } from '../src/key-release.js';
import { ShortcutManager } from '../src/shortcuts.js';
import { SINGLE_KEY_SHORTCUTS } from '../src/core/shortcuts.js';

test('Mac native event chain keeps a shortcut held until its own release, including repeat and cancellation', { skip: process.platform !== 'darwin' }, async () => {
  execFileSync(process.execPath, ['scripts/build-native.js', '--test'], { stdio: 'pipe' });
  const native = createRequire(import.meta.url)('../build/native-tests/key-release.node');
  const watch = createReleaseWatcher(native);
  const callbacks = new Map(), actions = [];
  const api = { register: (key, cb) => { callbacks.set(key, cb); return true; }, unregister: key => callbacks.delete(key), setSuspended() {} };
  const manager = new ShortcutManager(api, action => actions.push(action), watch);
  const flush = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    manager.start(SINGLE_KEY_SHORTCUTS);
    assert.throws(() => native.arm(), /key-press event/);
    native.testDeliver(5, 100, callbacks.get('F8'));
    await flush(); assert.deepEqual(actions, ['speak-start']);
    native.testDeliver(5, 100, callbacks.get('F8'));
    native.testDeliver(5, 101, callbacks.get('F7'));
    native.testDeliver(6, 101); await flush();
    assert.deepEqual(actions, ['speak-start', 'next']);
    native.testDeliver(6, 100); await flush();
    assert.deepEqual(actions, ['speak-start', 'next', 'speak-end']);
    native.testDeliver(6, 100); await flush(); assert.equal(actions.length, 3);
    native.testDeliver(5, 200, callbacks.get('F8'));
    manager.setEditing(true); native.testDeliver(6, 200); await flush();
    assert.deepEqual(actions.slice(3), ['speak-start', 'speak-cancel']);
    manager.setEditing(false);
    native.testDeliver(5, 201, callbacks.get('F8'));
    native.testDeliver(6, 200); await flush(); assert.equal(actions.at(-1), 'speak-start');
    native.testDeliver(6, 201); await flush(); assert.equal(actions.at(-1), 'speak-end');
    // Refreshing the hook does not lose the ID of an ongoing recording.
    native.testDeliver(5, 202, callbacks.get('F8'));
    watch.refresh(); native.testDeliver(6, 202); await flush(); assert.equal(actions.at(-1), 'speak-end');
  } finally { manager.cancelHold(); watch.close(); }
});
