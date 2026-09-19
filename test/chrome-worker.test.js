import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('companion restricts controls to its window and excludes Google sign-in content', async () => {
  const event = () => { const listeners = []; return { addListener: fn => listeners.push(fn), emit: (...args) => listeners.map(fn => fn(...args)) }; };
  const response = event(), messages = [], scripts = [], tabs = [{ id: 100, windowId: 1, active: true, url: 'https://private.example/', title: 'Unrelated user tab' }];
  const port = { onMessage: response, onDisconnect: event(), postMessage: value => messages.push(value) };
  const runtimeMessages = event();
  const chrome = {
    runtime: { id: 'test', getURL: name => `chrome-extension://test/${name}`, connectNative: () => port, onMessage: runtimeMessages, onInstalled: event(), onStartup: event() },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    windows: { create: async () => { const tab = { id: 200, windowId: 2, active: true, url: 'chrome-extension://test/welcome.html', status: 'complete' }; tabs.push(tab); return { id: 2, tabs: [tab] }; }, update: async () => {}, onRemoved: event() },
    tabs: { query: async ({ windowId }) => tabs.filter(tab => tab.windowId === windowId), get: async id => tabs.find(tab => tab.id === id),
      update: async (id, updates) => Object.assign(tabs.find(tab => tab.id === id), updates),
      sendMessage: async () => ({ ok: true, value: { title: 'Fixture', pageId: 'one', url: 'https://example.test/', results: [] } }),
      onUpdated: event(), onActivated: event(), onRemoved: event() },
    scripting: { executeScript: async args => scripts.push(args) },
    alarms: { create() {}, onAlarm: event() }, action: { onClicked: event() }
  };
  vm.runInNewContext(await readFile('src/chrome-extension/worker.js', 'utf8'), { chrome, URL, setTimeout, clearTimeout, AbortController });
  response.emit({ type: 'ready' });
  let next = 0;
  const request = async (method, args = {}) => {
    const id = String(++next); response.emit({ type: 'request', id, method, args });
    const deadline = Date.now() + 2000;
    while (!messages.some(value => value.id === id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    const result = messages.find(value => value.id === id); assert.ok(result, method); return result;
  };
  assert.equal((await request('start')).ok, true);
  const listed = await request('tabs'); assert.equal(listed.value.length, 1); assert.equal(listed.value[0].id, 200);
  assert.equal((await request('switch_tab', { id: 100 })).ok, false);
  assert.equal((await request('execute', { action: 'navigate', url: 'javascript:alert(1)' })).ok, false);
  assert.equal((await request('execute', { action: 'navigate', url: 'https://accounts.google.com/signin?private=secret' })).ok, true);
  const signIn = await request('snapshot'); assert.equal(signIn.value.manual, true); assert.equal(scripts.length, 0);
  assert.equal(JSON.stringify(signIn).includes('private=secret'), false);
  assert.equal((await request('execute', { action: 'play' })).ok, false);
  await request('execute', { action: 'navigate', url: 'https://example.test/' });
  assert.ok(scripts.length > 0); assert.ok(scripts.every(args => args.target.tabId === 200));
  let replied = false;
  runtimeMessages.emit({ type: 'execute', action: 'navigate', url: 'https://malicious.example/' }, { id: 'test', frameId: 0, url: 'https://example.test/', tab: tabs[1] }, () => { replied = true; });
  assert.equal(replied, false); assert.equal(tabs[1].url, 'https://example.test/');
  assert.equal(tabs[0].url, 'https://private.example/');
  tabs.splice(1); chrome.windows.onRemoved.emit(2);
  const closed = await request('snapshot');
  assert.equal(closed.value.closed, true);
  assert.equal(tabs.length, 1, 'background refresh must not reopen a window the user closed');
  assert.equal((await request('activate', { snapshot: { tabId: 200 } })).ok, false);
  assert.equal(tabs.length, 1, 'stale actions must not create replacement windows');
  await request('start'); assert.equal(tabs.length, 2, 'an explicit start can reopen the browsing window');
});
