let port = null, ready = false, managedWindow = null, opening = null;
const jobs = new Map();
const restored = chrome.storage.session.get('windowId').then(value => { managedWindow = value.windowId || null; });
const welcome = chrome.runtime.getURL('welcome.html');
const safeWeb = value => { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose an ordinary web address.'); return url.href; };
const manual = url => /^https:\/\/accounts\.google\.com\//i.test(url || '');
const check = signal => { if (signal?.aborted) throw new Error('Cancelled'); };
function send(value) { if (port) { try { port.postMessage(value); } catch { /* reconnect on next request */ } } }
function changed() { if (ready) send({ type: 'changed' }); }
function connect() {
  if (port) return;
  const connection = chrome.runtime.connectNative('com.svara.browser'); port = connection;
  connection.onMessage.addListener(message => {
    if (message?.type === 'ready') { ready = true; changed(); return; }
    if (message?.type === 'cancel') { jobs.get(message.id)?.abort(); return; }
    if (message?.type !== 'request' || typeof message.id !== 'string' || jobs.has(message.id)) return;
    const controller = new AbortController(); jobs.set(message.id, controller);
    dispatch(message.method, message.args || {}, controller.signal).then(value => {
      check(controller.signal); send({ type: 'result', id: message.id, ok: true, value });
    }).catch(error => send({ type: 'result', id: message.id, ok: false, error: String(error.message).slice(0, 240) }))
      .finally(() => jobs.delete(message.id));
  });
  connection.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== connection) return;
    port = null; ready = false;
    for (const job of jobs.values()) job.abort(); jobs.clear();
    chrome.alarms.create('reconnect', { delayInMinutes: 0.5 });
  });
}
async function windowTabs(create = true) {
  await restored;
  if (managedWindow) {
    const tabs = await chrome.tabs.query({ windowId: managedWindow }).catch(() => []);
    if (tabs.length) return tabs;
    managedWindow = null;
  }
  if (!create) return [];
  if (!opening) opening = chrome.windows.create({ url: welcome, type: 'normal', focused: false }).then(async window => {
    managedWindow = window.id; await chrome.storage.session.set({ windowId: managedWindow }); return window.tabs;
  }).finally(() => { opening = null; });
  return opening;
}
async function activeTab(create = true) { const tabs = await windowTabs(create); return tabs.find(tab => tab.active) || tabs[0]; }
async function content(tab, command, signal) {
  check(signal);
  safeWeb(tab.url);
  if (manual(tab.url)) throw new Error('Complete sign-in directly in Chrome. Svara does not read or fill this page.');
  // Inject only into the explicitly managed browsing window, never every tab.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['collector.js', 'content.js'] });
  check(signal);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'svara', ...command }, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error || 'The page changed. Refresh the reading list.');
  return response.value;
}
function emptyPage(tab) {
  const isManual = manual(tab.url);
  return { pageId: `chrome-${tab.id}-${isManual ? 'manual' : 'welcome'}`, tabId: tab.id, url: isManual ? 'https://accounts.google.com/' : welcome,
    title: isManual ? 'Sign in directly in Chrome. Svara does not read this page.' : 'Chrome is connected. Choose a website in Svara.',
    manual: isManual, language: 'en-US', elements: [], links: [], results: [], headings: [], article: [], pagination: null };
}
async function snapshot(tab, signal) {
  if (manual(tab.url) || !/^https?:/.test(tab.url || '')) return emptyPage(tab);
  return { ...await content(tab, { action: 'snapshot' }, signal), tabId: tab.id };
}
async function settled(id, signal) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    check(signal); const tab = await chrome.tabs.get(id);
    if (tab.status === 'complete') return tab;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return chrome.tabs.get(id);
}
async function dispatch(method, args, signal) {
  check(signal);
  if (method === 'tabs') return (await windowTabs(false)).map(tab => ({ id: tab.id, title: manual(tab.url) ? 'Google sign-in' : tab.title || 'New tab', url: manual(tab.url) ? 'https://accounts.google.com/' : tab.url, active: tab.active }));
  if (method === 'start') { const tab = await activeTab(); return snapshot(tab, signal); }
  if (!['snapshot', 'show', 'switch_tab', 'activate', 'verify', 'load_more', 'execute'].includes(method)) throw new Error('That Chrome control is not available.');
  const tab = await activeTab(method === 'show' || method === 'execute'); check(signal);
  if (!tab) {
    if (method !== 'snapshot') throw new Error('The browsing window has closed. Choose a website to open it again.');
    return { ...emptyPage({ id: 'closed' }), closed: true, title: 'Your Chrome window is closed. Choose a website to continue.' };
  }
  if (method === 'snapshot') return snapshot(tab, signal);
  if (method === 'show') { await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); return true; }
  if (method === 'switch_tab') {
    const tabs = await windowTabs(); const chosen = tabs.find(item => item.id === args.id);
    if (!chosen) throw new Error('That tab has closed or moved outside Svara.');
    check(signal); await chrome.tabs.update(chosen.id, { active: true }); return snapshot(chosen, signal);
  }
  if (['activate', 'verify', 'load_more'].includes(method)) {
    if (args.snapshot?.tabId !== tab.id) throw new Error('The page changed. Refresh the reading list.');
    const value = await content(tab, { action: method, ...args }, signal);
    if (value?.openUrl) {
      check(signal); const created = await chrome.tabs.create({ windowId: tab.windowId, url: safeWeb(value.openUrl), active: true });
      await settled(created.id, signal);
    } else if (method === 'activate') await settled(tab.id, signal);
    return value;
  }
  if (method !== 'execute') throw new Error('That Chrome control is not available.');
  const action = args.action;
  if (action === 'navigate') {
    const url = safeWeb(args.url); check(signal);
    await chrome.tabs.update(tab.id, { url }); return snapshot(await settled(tab.id, signal), signal);
  }
  if (action === 'new_tab') {
    const created = await chrome.tabs.create({ windowId: tab.windowId, url: welcome, active: true }); return emptyPage(created);
  }
  if (action === 'close_tab') {
    const tabs = await windowTabs(); check(signal);
    if (tabs.length === 1) await chrome.tabs.create({ windowId: tab.windowId, url: welcome });
    await chrome.tabs.remove(tab.id); return snapshot(await activeTab(), signal);
  }
  if (action === 'next_tab' || action === 'previous_tab') {
    const tabs = await windowTabs(), index = tabs.findIndex(item => item.id === tab.id);
    const chosen = tabs[(index + (action === 'next_tab' ? 1 : -1) + tabs.length) % tabs.length];
    check(signal); await chrome.tabs.update(chosen.id, { active: true }); return snapshot(chosen, signal);
  }
  if (['back', 'forward', 'reload'].includes(action)) {
    check(signal);
    if (action === 'back') await chrome.tabs.goBack(tab.id);
    else if (action === 'forward') await chrome.tabs.goForward(tab.id);
    else await chrome.tabs.reload(tab.id);
    return snapshot(await settled(tab.id, signal), signal);
  }
  if (['play', 'pause', 'media_toggle', 'scroll_down', 'scroll_up'].includes(action)) return content(tab, { action }, signal);
  throw new Error('That browser action is not available.');
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Content scripts may report a change, but cannot send browser commands.
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'page-changed' && sender.frameId === 0 && /^https?:/.test(sender.url || '') && sender.tab?.windowId === managedWindow) { if (sender.tab.active) changed(); return; }
  if (sender.url?.split('#')[0] !== welcome || message?.type !== 'connect') return;
  connect();
  reply({ connected: ready });
});
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.windowId === managedWindow && tab.active && (change.status || change.url)) changed(); });
chrome.tabs.onActivated.addListener(info => { if (info.windowId === managedWindow) changed(); });
chrome.tabs.onRemoved.addListener((_id, info) => { if (info.windowId === managedWindow) changed(); });
chrome.windows.onRemoved.addListener(id => { if (id === managedWindow) { managedWindow = null; chrome.storage.session.remove('windowId'); changed(); } });
chrome.action.onClicked.addListener(async () => { connect(); const tab = await activeTab(); await chrome.windows.update(tab.windowId, { focused: true }); });
chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'reconnect') connect(); });
connect();
