import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChromeBridge, packet, decoder } from '../src/browser/bridge.js';
import { installChromeHost } from '../src/browser/chrome-setup.js';
import { ConnectedBrowser } from '../src/browser/connected-browser.js';
import { EventEmitter, once } from 'node:events';

test('native messages handle fragmentation and reject excessive or malformed frames', () => {
  const values = [], errors = [], read = decoder(value => values.push(value), error => errors.push(error));
  const bytes = Buffer.concat([packet({ text: 'සිංහල' }), packet({ ready: true })]);
  for (const byte of bytes) read(Buffer.from([byte]));
  assert.deepEqual(values, [{ text: 'සිංහල' }, { ready: true }]);
  const huge = Buffer.alloc(4); huge.writeUInt32LE(1024 * 1024 + 1); read(huge);
  assert.equal(errors.length, 1); read(packet({ ignored: true })); assert.equal(values.length, 2);
  assert.throws(() => packet({ text: 'a'.repeat(1024 * 1024) }), /too large/);
});

test('native connection checks identity, cancels pending work, and reconnects without replay', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-bridge-'));
  const bridge = new ChromeBridge({ directory, extensionId: 'a'.repeat(32) });
  let peer;
  try {
    await bridge.start();
    const wrong = net.connect(bridge.socketPath); await once(wrong, 'connect'); wrong.write(packet({ type: 'hello', extensionId: 'b'.repeat(32) })); await once(wrong, 'close');
    assert.equal(bridge.connected, false);
    peer = net.connect(bridge.socketPath); await once(peer, 'connect');
    const received = [], events = new EventEmitter();
    peer.on('data', decoder(value => { received.push(value); events.emit('message', value); }, error => { throw error; }));
    peer.write(packet({ type: 'hello', extensionId: 'a'.repeat(32) })); await bridge.wait();
    const controller = new AbortController();
    const request = bridge.request('activate', { target: { id: 's1' } }, controller.signal);
    const failed = assert.rejects(request, { name: 'AbortError' });
    controller.abort(); await failed;
    const next = bridge.request('tabs');
    while (!received.some(value => value.method === 'tabs')) await once(events, 'message');
    const old = received.find(value => value.method === 'activate'), current = received.find(value => value.method === 'tabs');
    peer.write(packet({ type: 'result', id: old.id, ok: true, value: 'late' }));
    peer.write(packet({ type: 'result', id: current.id, ok: true, value: [] }));
    assert.deepEqual(await next, []); assert.ok(received.some(value => value.type === 'cancel' && value.id === old.id));
    const lost = assert.rejects(bridge.request('snapshot'), /disconnected/); peer.destroy(); await lost;
    assert.equal(bridge.pending.size, 0);
  } finally { peer?.destroy(); await bridge.close(); await rm(directory, { recursive: true, force: true }); }
});

test('host registration uses an exact extension origin and quotes local paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'svara-host-'));
  try {
    const setup = await installChromeHost({ directory: path.join(root, "Svara's data"), executable: '/Applications/Svara.app/Contents/MacOS/Svara',
      relayPath: '/Applications/Svara.app/Contents/Resources/native-host.cjs', extensionDirectory: 'build/chrome-extension', socketPath: '/tmp/svara-test.sock', home: root });
    const manifest = JSON.parse(await readFile(path.join(root, 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.svara.browser.json'), 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${setup.extensionId}/`]);
    const script = await readFile(manifest.path, 'utf8');
    assert.match(script, /ELECTRON_RUN_AS_NODE=1/); assert.match(script, /"\$@"/); assert.doesNotMatch(script, /debugging|automation/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('live browser sends bounded named commands, preserves Sinhala, and leaves Chrome open on quit', async () => {
  const bridge = new EventEmitter(), calls = [];
  const snapshot = { pageId: 'one', tabId: 12345678, url: 'https://example.com', results: [], manual: false };
  Object.assign(bridge, { connected: true, request: async (method, args, signal) => { signal?.throwIfAborted(); calls.push({ method, args }); return snapshot; }, close: async () => calls.push({ method: 'disconnect' }) });
  const browser = new ConnectedBrowser({ directory: '/unused', bridge, openChrome: async () => {}, onChange() {} });
  await browser.startLive();
  await browser.execute('search', { site: 'youtube', payload: 'සිංහල ගීත' });
  assert.equal(new URL(calls.at(-1).args.url).searchParams.get('search_query'), 'සිංහල ගීත');
  await assert.rejects(browser.execute('navigate', { url: 'javascript:alert(1)' }));
  await browser.activate({ id: 's1' }, snapshot, 'සිංහල');
  assert.equal(calls.at(-1).args.text, 'සිංහල'); assert.equal(calls.at(-1).args.snapshot.tabId, 12345678);
  await browser.close(); assert.equal(calls.at(-1).method, 'disconnect');
});
