import { app, BrowserWindow, ipcMain, Menu, globalShortcut, dialog, safeStorage, systemPreferences, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Settings } from './settings.js';
import { BrowserController } from './browser/browser.js';
import { GoogleServices } from './services/google.js';
import { JevService } from './services/jev.js';
import { Engine } from './core/engine.js';
import { ShortcutManager } from './shortcuts.js';
import { STOP_SHORTCUT } from './core/shortcuts.js';
import { createReleaseWatcher } from './key-release.js';
import { positionSpeech } from './position-speech.js';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.join(root, 'renderer/index.html');
if (process.env.SVARA_TEST_USER_DATA) app.setPath('userData', process.env.SVARA_TEST_USER_DATA);
app.setName('Svara');
let window, settings, browser, engine;
let quitting = false;
const send = (type, data) => { if (window && !window.isDestroyed()) window.webContents.send(type, data); };

function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame
      || !event.senderFrame.url.startsWith('file:') || fileURLToPath(new URL(event.senderFrame.url)) !== rendererFile) {
      return { ok: false, error: 'This request did not come from Svara.' };
    }
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: engine?.friendlyError(e) || 'This action could not be completed.' }; }
  });
}

app.whenReady().then(async () => {
settings = new Settings(app.getPath('userData'), safeStorage); await settings.load();
const google = new GoogleServices(() => settings.data);
browser = new BrowserController({ directory: app.getPath('userData'), headless: process.env.SVARA_TEST_HEADLESS === '1',
  practiceDirectory: app.isPackaged ? path.join(process.resourcesPath, 'practice') : undefined,
  onChange: () => { browser.tabs().then(tabs => send('tabs', tabs)).catch(() => {}); engine?.browserChanged(); } });
const jev = new JevService(() => settings.data);
engine = new Engine({ browser, google, jev, settings: () => settings.data });
positionSpeech.onFailure = () => send('navigation-tone');
engine.on('stop', () => positionSpeech.stop());
engine.on('narration', () => positionSpeech.stop());
const releaseModule = app.isPackaged ? path.join(process.resourcesPath, 'native/key-release.node') : path.join(root, '../build/native/key-release.node');
const watchRelease = createReleaseWatcher(createRequire(import.meta.url)(releaseModule));
const shortcuts = new ShortcutManager(globalShortcut, action => {
  if (action === 'stop') { engine.stop(); send('cancel-recording'); }
  send('shortcut-action', action);
}, watchRelease);
let shortcutWarning = '';
for (const event of ['state', 'narration', 'stop', 'notice', 'reader-focus', 'reader-position']) engine.on(event, data => send(event, data));

session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
  callback(contents === window?.webContents && permission === 'media' && details.mediaTypes?.every(t => t === 'audio')
    && contents.getURL().startsWith('file:'));
});
session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window?.webContents && permission === 'media');

window = new BrowserWindow({ width: 1240, height: 860, minWidth: 940, minHeight: 700,
  title: 'Svara', backgroundColor: '#f6f8f7', titleBarStyle: 'hiddenInset',
  webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false }
});
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', event => event.preventDefault());
window.webContents.on('will-attach-webview', event => event.preventDefault());

handle('initial', async () => ({ state: engine.view(), settings: settings.public(), tabs: await browser.tabs(), version: app.getVersion(), shortcutWarning }));
handle('settings-save', input => {
  if (input && Object.hasOwn(input, 'shortcuts')) throw new Error('Save keyboard choices from Keyboard shortcuts.');
  return settings.save(input);
});
handle('shortcuts-save', async input => {
  const result = await shortcuts.save(input, next => settings.saveShortcuts(next));
  shortcutWarning = ''; return result;
});
handle('shortcuts-editing', value => {
  if (typeof value !== 'boolean') throw new Error('Choose a shortcut setting.');
  shortcuts.setEditing(value);
  if (value) positionSpeech.stop();
});
handle('credentials-file', async () => {
  const result = await dialog.showOpenDialog(window, { title: 'Choose Google Cloud credentials', properties: ['openFile'], filters: [{ name: 'Google service account JSON', extensions: ['json'] }] });
  if (result.canceled) return settings.public();
  const file = result.filePaths[0];
  const stat = await fs.stat(file);
  if (stat.size > 50000) throw new Error('Choose a Google service account credential file.');
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) throw new Error('This file is not a Google service account credential file.');
  return settings.setCredentialFile(file);
});
handle('connections-check', async () => {
  const [googleResults, jevResult] = await Promise.all([google.check(), jev.check()]);
  return [...googleResults, jevResult];
});
handle('start-browser', practice => { if (typeof practice !== 'boolean') throw new Error('Choose live or practice mode.'); return engine.start(practice); });
handle('show-browser', () => browser.show());
handle('speak-position', (number, epoch) => {
  if (Number.isInteger(number) && number === engine.reader.index + 1 && epoch === engine.epoch && settings.data.speechEnabled) positionSpeech.speak(number);
});
handle('focus-reader-window', () => { if (!quitting && !shortcuts.editing) { window.show(); window.focus(); } });
handle('reader-preference', async value => {
  if (typeof value !== 'boolean') throw new Error('Choose whether to read titles automatically.');
  return settings.save({ ...Object.fromEntries(['projectId', 'region', 'inputLanguage', 'voice', 'guidanceLanguage', 'speechEnabled', 'rate'].map(key => [key, settings.data[key]])), readOnFocus: value });
});
handle('command', text => { if (typeof text !== 'string') throw new Error('Enter a spoken or typed command.'); return engine.input(text); });
const allowed = new Set(['stop', 'select', 'open_item', 'open_current', 'confirm', 'choose', 'switch_tab', 'next', 'previous', 'repeat', 'read_results', 'read_headings', 'read_page', 'read_links', 'read_sinhala', 'read_original', 'where', 'help', 'back', 'forward', 'reload', 'new_tab', 'close_tab', 'next_tab', 'previous_tab', 'scroll_down', 'scroll_up', 'play', 'pause']);
allowed.add('read_first_five');
for (const action of ['focus_item', 'focus_next', 'focus_previous']) allowed.add(action);
handle('continue-reading', (epoch, index) => {
  if (!Number.isSafeInteger(epoch) || !Number.isInteger(index) || index < 0 || index > 4) throw new Error('That reading request is no longer available.');
  return engine.continueReading(epoch, index);
});
handle('control', (action, index) => {
  if (!allowed.has(action) || (index !== undefined && (!Number.isInteger(index) || index < 0 || index > 10000))) throw new Error('That control is not available.');
  return engine.control(action, index);
});
handle('open-site', site => {
  if (!['youtube', 'wikipedia', 'google'].includes(site)) throw new Error('Choose a supported website.');
  return engine.run(async (epoch, signal) => {
    if (browser.practice) { await browser.startLive(); engine.current(epoch); engine.reader.reset(); }
    await engine.perform('navigate', { site }, epoch, signal);
  });
});
handle('microphone-permission', async () => {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.askForMediaAccess('microphone');
});
handle('audio', data => {
  if (!(data instanceof Uint8Array) || data.length > 10 * 1024 * 1024) throw new Error('The recording is too large. Use a short command.');
  return engine.audio(Buffer.from(data));
});
handle('synthesize', async ({ text, language, epoch }) => {
  if (typeof text !== 'string' || typeof language !== 'string' || language.length > 35 || epoch !== engine.epoch) throw new Error('Reading was cancelled.');
  if (browser.practice || !settings.data.speechEnabled) return null;
  const audio = await google.synthesize(text, language); engine.current(epoch); return audio;
});
handle('voice-test', () => engine.run(async epoch => {
  if (browser.practice) await browser.startLive();
  engine.current(epoch);
  engine.say('ආයුබෝවන්. මම ස්වර. ඔබට අන්තර්ජාලය භාවිතා කිරීමට උදව් කරන්නම්.', 'si-LK');
}));

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Svara', submenu: [{ role: 'about' }, { label: 'Connections…', accelerator: 'CmdOrCtrl+,', click: () => send('navigate', 'settings') }, { label: 'Keyboard shortcuts…', accelerator: 'CmdOrCtrl+K', click: () => send('navigate', 'shortcuts') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
  { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'Browse', submenu: [{ label: 'Show browser', click: () => browser.show().catch(e => send('notice', { text: e.message, error: true })) }, { label: 'Stop reading', accelerator: 'Escape', click: () => { engine.stop(); send('cancel-recording'); } }, { label: 'Help', click: () => send('navigate', 'help') }] },
  { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  { role: 'windowMenu' }
]));
shortcutWarning = shortcuts.start(settings.data.shortcuts);
if (!globalShortcut.register(STOP_SHORTCUT, () => { engine.stop(); send('cancel-recording'); })) {
  shortcutWarning += ' The stop shortcut is unavailable. Escape still stops reading inside Svara.';
}
watchRelease.refresh();
window.webContents.on('render-process-gone', () => { positionSpeech.stop(); shortcuts.cancelHold(); shortcuts.setEditing(false); });
await window.loadFile(rendererFile);
app.on('activate', () => { if (window && !window.isDestroyed()) window.show(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  globalShortcut.unregisterAll();
  shortcuts.cancelHold();
  watchRelease.close();
  if (!quitting) { event.preventDefault(); quitting = true; engine.stop(); browser.close().finally(() => app.quit()); }
});
}).catch(error => {
  dialog.showErrorBox('Svara could not start', String(error.message || 'Please restart the app.'));
  app.quit();
});
