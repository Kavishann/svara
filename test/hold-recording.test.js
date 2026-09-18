import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldRecorder } from '../src/renderer/recording.js';
import { ShortcutManager } from '../src/shortcuts.js';
import { SINGLE_KEY_SHORTCUTS } from '../src/core/shortcuts.js';
import { createReleaseWatcher } from '../src/key-release.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(extra = {}) {
  const submissions = [], statuses = [], errors = [], streams = [], recorders = [];
  const hold = new HoldRecorder({
    prepare: async () => {},
    getStream: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } };
      const stream = { getTracks: () => [track], track }; streams.push(stream); return stream;
    },
    createRecorder: stream => {
      const recorder = { state: 'inactive', mimeType: 'audio/webm', stream, start() { this.state = 'recording'; },
        stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable({ data: new Blob(['x'.repeat(1800)]) }); this.onstop(); }); } };
      recorders.push(recorder); return recorder;
    },
    onState: status => statuses.push(status), submit: async bytes => submissions.push(bytes), onError: e => errors.push(e), ...extra
  });
  return { hold, submissions, statuses, errors, streams, recorders };
}
test('one hold records once despite repeat; release immediately submits final audio', async () => {
  const { hold, submissions, streams, recorders, statuses } = setup();
  await hold.start('shortcut'); await hold.start('shortcut');
  assert.equal(recorders.length, 1); assert.equal(submissions.length, 0);
  hold.finish('shortcut'); hold.finish('shortcut'); await tick();
  assert.equal(submissions.length, 1); assert.equal(submissions[0].length, 1800);
  assert.ok(streams[0].track.stopped); assert.ok(statuses.includes('sending')); assert.equal(hold.active, false);
});
test('release before permission resolves never starts a late recording', async () => {
  let permit; const { hold, streams, submissions } = setup({ prepare: () => new Promise(resolve => { permit = resolve; }) });
  const start = hold.start('shortcut'); hold.finish('shortcut'); permit(); await start;
  assert.equal(streams.length, 0); assert.equal(submissions.length, 0); assert.equal(hold.active, false);
});
test('late microphone stream is closed after cancel and cannot interfere with a new hold', async () => {
  let resolveStream;
  const { hold, streams, submissions } = setup(); const original = hold.getStream;
  hold.getStream = () => new Promise(resolve => { resolveStream = resolve; });
  const start = hold.start('old'); await tick(); hold.cancel();
  hold.getStream = original; await hold.start('new');
  const late = await original(); resolveStream(late); await start;
  assert.ok(late.track.stopped); assert.equal(streams[0].track.stopped, false);
  hold.finish('old'); assert.equal(hold.active, true);
  hold.finish('new'); await tick(); assert.equal(submissions.length, 1);
});
test('Escape discards audio even after stop queues the final data event', async () => {
  const { hold, submissions } = setup(); await hold.start('shortcut');
  hold.finish('shortcut'); hold.cancel(); await tick(); assert.equal(submissions.length, 0);
});
test('recording safety limit submits once and ignores a later release', async () => {
  const { hold, submissions } = setup({ maxDuration: 10 }); await hold.start('shortcut');
  await new Promise(resolve => setTimeout(resolve, 30)); hold.finish('shortcut'); await tick();
  assert.equal(submissions.length, 1); assert.equal(hold.active, false);
});
test('shortcut callbacks pair press/release, ignore repeat, and discard while editing', () => {
  const callbacks = {}, actions = []; let release, fail, disposed = false;
  const api = { register: (key, callback) => { callbacks[key] = callback; return true; }, setSuspended() {} };
  const manager = new ShortcutManager(api, action => actions.push(action), (_key, done, error) => {
    release = done; fail = error; return () => { disposed = true; };
  });
  manager.start(SINGLE_KEY_SHORTCUTS); callbacks.F8(); callbacks.F8(); release();
  assert.deepEqual(actions, ['speak-start', 'speak-end']);
  callbacks.F8(); manager.setEditing(true); release(); callbacks.F8();
  assert.equal(disposed, true); assert.deepEqual(actions.slice(2), ['speak-start', 'speak-cancel']);
  manager.setEditing(false); callbacks.F8(); fail(); assert.equal(actions.at(-1), 'speak-unavailable');
});
test('release watcher stays armed until its matching event, ignoring late or duplicate releases', async () => {
  let callback, token = 0, released = 0, failed = 0; const cancelled = [];
  const native = { initialize: cb => { callback = cb; }, arm: () => ++token, cancel: id => cancelled.push(id), refresh() {}, close() {} };
  const watch = createReleaseWatcher(native);
  const dispose = watch('Control+Space', () => released++, () => failed++);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(released, 0); assert.equal(failed, 0);
  callback(55); assert.equal(released, 0);
  callback(1); callback(1); assert.equal(released, 1);
  dispose(); watch('F8', () => released++, () => failed++)();
  callback(2); assert.equal(released, 1); assert.equal(failed, 0);
  watch.close();
});
test('missing release fails closed and closing removes pending releases', async () => {
  let callback, released = 0, failed = 0;
  const native = { initialize: cb => { callback = cb; }, arm: () => 1, cancel() {}, refresh() {}, close() {} };
  const watch = createReleaseWatcher(native, { timeout: 10 });
  watch('F8', () => released++, () => failed++);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(failed, 1); assert.equal(released, 0);
  watch('F8', () => released++, () => failed++); watch.close(); callback(1);
  assert.equal(released, 0);
});
