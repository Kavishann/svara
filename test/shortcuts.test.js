import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ShortcutManager } from '../src/shortcuts.js';
import { DEFAULT_SHORTCUTS, SINGLE_KEY_SHORTCUTS, normalizeShortcuts } from '../src/core/shortcuts.js';
import { Settings } from '../src/settings.js';
import { Engine } from '../src/core/engine.js';

const config = bindings => ({ enabled: true, bindings: { speak: '', previous: '', next: '', open: '', ...bindings } });
function platform() {
  return { keys: new Map(), blocked: new Set(), suspended: false,
    register(key, callback) { if (this.suspended || this.blocked.has(key) || this.keys.has(key)) return false; this.keys.set(key, callback); return true; },
    unregister(key) { this.keys.delete(key); }, setSuspended(value) { this.suspended = value; },
    press(key) { if (!this.suspended) this.keys.get(key)?.(); }
  };
}

test('shortcut validation supports single keys and rejects duplicate or reserved assignments', () => {
  assert.deepEqual(normalizeShortcuts(SINGLE_KEY_SHORTCUTS), SINGLE_KEY_SHORTCUTS);
  assert.equal(normalizeShortcuts(config({ speak: 'Alt+Control+Space' })).bindings.speak, 'Control+Alt+Space');
  assert.equal(normalizeShortcuts(config({ speak: 'Control+Space' })).bindings.media_toggle, '');
  assert.throws(() => normalizeShortcuts(config({ speak: 'F8', media_toggle: 'F8' })), /assigned twice/);
  assert.throws(() => normalizeShortcuts(config({ speak: 'F8', next: 'F8' })), /assigned twice/);
  assert.throws(() => normalizeShortcuts(config({ speak: 'Alt+Control+Space', next: 'Control+Alt+Space' })), /assigned twice/);
  for (const speak of ['Escape', 'Control+Alt+Escape', 'Command+Q', 'Command+C', 'Command+K', 'Fn', 'Control+Control+A', 'A+B']) {
    assert.throws(() => normalizeShortcuts(config({ speak })));
  }
});

test('conflicting shortcut changes preserve previous registrations and do not save', async () => {
  const api = platform(), actions = [], manager = new ShortcutManager(api, action => actions.push(action), () => () => {});
  manager.start(config({ speak: 'F8', next: 'F7' })); api.blocked.add('F9'); let saved = false;
  await assert.rejects(manager.save(config({ speak: 'F10', open: 'F9' }), async () => { saved = true; }), /unavailable/);
  assert.equal(saved, false); assert.equal(api.keys.has('F10'), false);
  api.press('F8'); api.press('F7'); assert.deepEqual(actions, ['speak-start', 'next']);
});

test('disk failures roll back new keys and editing never activates a browser action', async () => {
  const api = platform(), actions = [], manager = new ShortcutManager(api, action => actions.push(action), () => () => {});
  manager.start(config({ speak: 'F8' })); manager.setEditing(true);
  api.press('F8'); assert.deepEqual(actions, []);
  await assert.rejects(manager.save(config({ speak: 'F9' }), async () => { api.press('F9'); throw new Error('disk full'); }), /disk full/);
  assert.equal(api.suspended, true); assert.equal(api.keys.has('F9'), false);
  manager.setEditing(false); api.press('F8'); assert.deepEqual(actions, ['speak-start']);
});

test('swapping keys changes their actions and disabling frees keys for typing', async () => {
  const api = platform(), actions = [], manager = new ShortcutManager(api, action => actions.push(action), () => () => {});
  manager.start(config({ previous: 'F6', next: 'F7' }));
  await manager.save(config({ previous: 'F7', next: 'F6' }), async () => {});
  api.press('F6'); api.press('F7'); assert.deepEqual(actions, ['next', 'previous']);
  await manager.save({ ...manager.config, enabled: false }, async () => {});
  assert.equal(api.keys.size, 0); api.press('F6'); assert.equal(actions.length, 2);
});

test('existing connections migrate without shortcuts and keep secrets after key changes and restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-shortcuts-'));
  const secure = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text.split('').reverse().join('')),
    decryptString: bytes => bytes.toString().split('').reverse().join('') };
  try {
    const settings = new Settings(directory, secure);
    const { shortcuts, geminiKey, typesafeKey, ...legacy } = settings.data;
    const encryptedSecrets = secure.encryptString(JSON.stringify({ geminiKey: 'test-gemini', typesafeKey: 'test-jev' })).toString('base64');
    await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ ...legacy, projectId: 'saved-project', encryptedSecrets }));
    await settings.load(); assert.deepEqual(settings.data.shortcuts, DEFAULT_SHORTCUTS);
    await settings.saveShortcuts(SINGLE_KEY_SHORTCUTS);
    const restarted = new Settings(directory, secure); await restarted.load();
    assert.deepEqual(restarted.data.shortcuts, SINGLE_KEY_SHORTCUTS);
    assert.equal(restarted.data.projectId, 'saved-project'); assert.equal(restarted.data.geminiKey, 'test-gemini'); assert.equal(restarted.data.typesafeKey, 'test-jev');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('open-current uses the selected item and preserves confirmation protection', async () => {
  const links = ['first', 'second'].map(id => ({ id, targetId: id, text: id, role: 'link', href: `https://example.com/${id}` }));
  const snapshot = { pageId: 'one', url: 'https://example.com', title: 'Example', results: links, headings: [], elements: links };
  const opened = [];
  const browser = { practice: false, verifyTarget: async () => {}, activate: async target => opened.push(target.id), snapshot: async () => snapshot };
  const engine = new Engine({ browser, google: {}, jev: {}, settings: () => ({ guidanceLanguage: 'en-US' }) });
  engine.reader.load(snapshot); engine.reader.select(1); await engine.control('open_current');
  assert.deepEqual(opened, ['second']);
  engine.reader.items = [{ id: 'send', targetId: 'send', text: 'Send', role: 'button' }]; engine.reader.index = 0;
  await engine.control('open_current'); assert.equal(engine.pending.kind, 'confirm'); assert.deepEqual(opened, ['second']);
  await engine.control('open_current'); assert.deepEqual(opened, ['second']);
  assert.match(engine.message, /pending choice/);
});

test('spoken help announces the saved shortcut assignments', () => {
  const engine = new Engine({ browser: {}, settings: () => ({ guidanceLanguage: 'si-LK', shortcuts: SINGLE_KEY_SHORTCUTS }) });
  engine.tell('help'); assert.match(engine.message, /F8/); assert.match(engine.message, /F6/); assert.match(engine.message, /F7/); assert.match(engine.message, /F9/);
  assert.doesNotMatch(engine.message, /Control Option Space/);
});

test('legacy four-key preferences migrate and the added Read/Stop actions dispatch independently', async () => {
  const old = normalizeShortcuts(config({ speak: 'Control+Space' }));
  assert.equal(old.bindings.read, ''); assert.equal(old.bindings.stop, ''); assert.equal(old.bindings.speak, 'Control+Space');
  const api = platform(), actions = [], manager = new ShortcutManager(api, action => actions.push(action), () => () => {});
  manager.start(old);
  await manager.save(config({ speak: 'Control+Space', read: 'F10', stop: 'F12' }), async () => {});
  api.press('F10'); api.press('F12'); assert.deepEqual(actions, ['read', 'stop']);
  assert.throws(() => normalizeShortcuts(config({ read: 'F10', stop: 'F10' })), /assigned twice/);
  assert.equal(new Settings('/unused', {}).data.readOnFocus, false);
});

test('overlapping speaking and media keys keep the original release watcher and suppress repeats', () => {
  const api = platform(), actions = [], watched = []; let release;
  const manager = new ShortcutManager(api, action => actions.push(action), (key, done) => {
    watched.push(key); release = done; return () => {};
  });
  manager.start(config({ speak: 'F8', media_toggle: 'F9' }));
  api.press('F8'); api.press('F9'); api.press('F8');
  assert.deepEqual(watched, ['F8']); release();
  assert.deepEqual(actions, ['speak-start', 'speak-end']);
  api.press('F9'); api.press('F9'); api.press('F8');
  assert.deepEqual(watched, ['F8', 'F9']); release();
  assert.deepEqual(actions, ['speak-start', 'speak-end', 'media_toggle']);
  api.press('F8'); release();
  assert.deepEqual(actions.slice(-2), ['speak-start', 'speak-end']);
});
