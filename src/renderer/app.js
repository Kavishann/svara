import { splitForSpeech, speechLocale } from './audio.js';
import { DEFAULT_SHORTCUTS, shortcutLabel } from '../core/shortcuts.js';
import { createShortcutEditor } from './shortcuts.js';
import { HoldRecorder } from './recording.js';
import { PcmPlayer } from './pcm-player.js';
const api = window.svara;
const $ = selector => document.querySelector(selector);
let state, settings, currentView = 'home', tabs = [];
let cloudPlayback = null, playback = 0, noticeTimer;
let navigation = Promise.resolve(), navigationVersion = 0;
const shortcutEditor = createShortcutEditor({ api, saved: fillSettings, activate: () => view('home'), notice });

function notice(text, error = true) {
  clearTimeout(noticeTimer); const box = $('#notice'); box.textContent = text; box.hidden = false; box.classList.toggle('success', !error);
  if (!error) noticeTimer = setTimeout(() => { box.hidden = true; }, 8000);
}
async function attempt(fn) {
  try { return await fn(); } catch (e) { notice(e.message); return null; }
}
async function view(name) {
  if (!['home', 'reader', 'settings', 'shortcuts', 'help'].includes(name)) return;
  try { await api.editShortcuts(name === 'shortcuts'); } catch (error) { notice(error.message); return; }
  if (name === 'shortcuts') { cancelRecording(); stopPlayback(); shortcutEditor.fill(settings.shortcuts); }
  currentView = name;
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${name}`; });
  document.querySelectorAll('.nav-button').forEach(el => { el.classList.toggle('active', el.dataset.view === name); if (el.dataset.view === name) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  const labels = { home: ['WELCOME TO SVARA', 'Your browser, at your pace.'], reader: ['YOUR BROWSER', 'Find your place. Follow your curiosity.'], settings: ['CONNECTIONS', 'A few details, then you’re ready.'], shortcuts: ['KEYBOARD SHORTCUTS', 'Your keys. Your pace.'], help: ['HELP & COMMANDS', 'You’re in control.'] };
  $('#view-eyebrow').textContent = labels[name][0]; $('#breadcrumb').textContent = labels[name][1];
  $('#main').focus({ preventScroll: true });
  if (name === 'reader') focusSelected();
}
function focusSelected() {
  const item = $('#reading-list').querySelector(`[data-item-index="${state?.reader.index}"]`);
  (item || $('#page-title')).focus({ preventScroll: true });
  item?.scrollIntoView({ block: 'nearest' });
}
async function focusReader({ raise = false } = {}) {
  // Do not discard a connection form or shortcut choice while the browser loads.
  if (['settings', 'shortcuts'].includes(currentView)) return;
  if (currentView !== 'reader') await view('reader');
  focusSelected();
  if (raise) await attempt(() => api.focusReaderWindow());
}
function render(next) {
  state = next;
  $('#status-message').textContent = next.message;
  $('#status-label').textContent = ({ ready: 'A conversation starts here', working: 'Working on your command…', listening: 'Recognizing your speech…', error: 'Let’s try that again', confirm: 'Waiting for your choice' })[next.status] || next.status;
  $('#working-dot').hidden = !['working', 'listening'].includes(next.status);
  $('#mode-pill').replaceChildren(Object.assign(document.createElement('span'), {}), document.createTextNode(next.practice ? 'Practice · cloud speech off' : next.page ? 'Live browsing' : 'Ready to explore'));
  $('#live-mode').hidden = !next.practice;
  $('#reader-count').textContent = next.reader.items.length;
  $('#page-title').textContent = next.page?.title || 'No page open yet';
  $('#page-url').textContent = next.practice ? 'Local practice page · fictional content' : next.page?.url || 'Open a website or start with the practice page.';
  $('#list-count').textContent = `${next.reader.items.length} items${next.loadingMore ? ' · Looking for more…' : ''}`;
  $('#reader-empty').hidden = next.reader.items.length > 0;
  $('#transcript-line').hidden = !next.transcript;
  $('#transcript-line').textContent = next.english ? `${next.transcript} → ${next.english}` : next.transcript;
  document.querySelectorAll('[data-scope]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.scope === next.reader.scope)));
  const list = $('#reading-list');
  const signature = JSON.stringify([next.reader.items, next.reader.index]);
  if (list.dataset.signature !== signature) {
    const focusedIndex = document.activeElement?.dataset?.itemIndex;
    list.dataset.signature = signature;
    list.replaceChildren(...next.reader.items.map((item, index) => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.className = 'item-button'; button.dataset.itemIndex = index;
      button.tabIndex = index === next.reader.index ? 0 : -1;
      button.setAttribute('aria-current', String(index === next.reader.index));
      button.setAttribute('aria-label', `${item.targetId ? 'Open' : 'Read'} item ${index + 1}: ${item.text}`);
      const number = document.createElement('span'); number.className = 'item-number'; number.textContent = index + 1;
      const words = document.createElement('span'), title = document.createElement('strong'); title.textContent = item.text; title.lang = item.language || '';
      words.append(title);
      if (item.meta) { const meta = document.createElement('small'); meta.textContent = item.meta; words.append(meta); }
      button.append(number, words); button.addEventListener('click', () => control(item.targetId ? 'open_item' : 'select', index)); li.append(button); return li;
    }));
    if (focusedIndex !== undefined) list.querySelector(`[data-item-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
  }
  const item = next.reader.items[next.reader.index];
  $('#current-text').textContent = item?.text || 'Your selected item will appear here.';
  $('#current-text').lang = item?.language || 'en';
  $('#current-meta').textContent = item?.meta || '';
  $('#position').textContent = item ? `${next.reader.index + 1} / ${next.reader.items.length}` : '—';
  $('#open-item').disabled = !item?.targetId;
  $('#read-first-five').disabled = !next.reader.items.length || Boolean(next.pending);
  $('#translate-item').textContent = next.reader.language === 'original' ? 'Read this in Sinhala' : 'Read the original';
  const confirmation = $('#confirmation'), wasHidden = confirmation.hidden;
  confirmation.hidden = !next.pending;
  if (next.pending) {
    $('#confirmation-text').textContent = next.pending.label;
    const options = $('#confirmation-options'); options.replaceChildren();
    const add = (label, action, index) => { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label; button.onclick = () => control(action, index); options.append(button); };
    if (next.pending.kind === 'confirm') add('Confirm · තහවුරු කරන්න', 'confirm');
    else next.pending.candidates.forEach((item, index) => add(`${index + 1}. ${item.text}`, 'choose', index));
    add('Cancel · අවලංගු කරන්න', 'stop');
    if (wasHidden) { confirmation.scrollIntoView({ block: 'nearest' }); options.querySelector('button')?.focus(); }
  }
}
function renderTabs(data) {
  tabs = data;
  $('#tabs-bar').replaceChildren(...data.map(tab => {
    const button = document.createElement('button'); button.className = 'tab'; button.textContent = tab.title || 'New tab';
    button.setAttribute('aria-pressed', String(tab.active)); button.onclick = () => control('switch_tab', tab.id); return button;
  }));
}
function renderChrome(data) {
  $('#chrome-status').textContent = data.testing ? 'Practice and test browser.' : data.connected ? 'Chrome is connected. Your browsing controls are ready.' : 'Chrome is not connected yet. Complete the one-time setup below.';
}
$('#chrome-setup').onclick = () => attempt(async () => renderChrome(await api.setupChrome()));
$('#chrome-connect').onclick = () => attempt(async () => { render(await api.connectChrome()); renderChrome(await api.chromeStatus()); });
api.onChromeStatus(renderChrome);
function fillSettings(data) {
  settings = data;
  for (const [selector, key] of Object.entries({ '#project-id': 'projectId', '#region': 'region', '#input-language': 'inputLanguage', '#voice': 'voice', '#guidance-language': 'guidanceLanguage', '#rate': 'rate' })) $(selector).value = data[key];
  $('#speech-enabled').checked = data.speechEnabled;
  $('#read-on-focus').checked = data.readOnFocus !== false;
  $('#gemini-key').value = ''; $('#typesafe-key').value = '';
  $('#gemini-key').placeholder = data.hasGeminiKey ? 'Saved securely · leave blank to keep' : 'Paste your Gemini API key';
  $('#typesafe-key').placeholder = data.hasTypesafeKey ? 'Saved securely · leave blank to keep' : 'Paste your TypeSafe API key';
  $('#gemini-status').textContent = data.hasGeminiKey ? 'API key saved. Model: Gemini 3.8 Flash.' : 'Used for translating commands and content when requested.';
  $('#jev-status').textContent = data.hasTypesafeKey ? 'API key saved. Model: Jev 1.13.0.' : 'Chooses browser actions and page elements.';
  $('#credential-file').textContent = data.credentialFile ? `Selected file: ${data.credentialFile}` : 'Or use Google Application Default Credentials already configured on this Mac.';
  $('#setup-dot').hidden = Boolean(data.hasGeminiKey && data.hasTypesafeKey && data.projectId);
  $('#rate-value').textContent = `${Number(data.rate).toFixed(1)}×`;
  const shortcuts = data.shortcuts || DEFAULT_SHORTCUTS;
  document.querySelectorAll('[data-shortcut-hint]').forEach(element => {
    const value = shortcuts.enabled ? shortcuts.bindings[element.dataset.shortcutHint] : '';
    element.textContent = value ? shortcutLabel(value) : 'Shortcut off';
  });
  for (const [selector, action] of Object.entries({ '#talk': 'speak', '[data-action="focus_next"]': 'next', '[data-action="focus_previous"]': 'previous', '#open-item': 'open', '#read-selected': 'read', '#stop-all': 'stop', '#read-first-five': 'first_five', '[data-scope="results"]': 'results', '[data-scope="headings"]': 'headings', '[data-scope="article"]': 'page_text', '[data-scope="links"]': 'links' })) {
    const button = $(selector), key = shortcuts.enabled && shortcuts.bindings[action];
    button.title = key ? shortcutLabel(key) : 'Choose a key in Keyboard shortcuts';
  }
  if (data.warning) notice(data.warning);
}
function settingsInput(extra = {}) {
  return { projectId: $('#project-id').value.trim(), region: $('#region').value, inputLanguage: $('#input-language').value,
    voice: $('#voice').value, guidanceLanguage: $('#guidance-language').value, speechEnabled: $('#speech-enabled').checked, readOnFocus: $('#read-on-focus').checked,
    rate: Number($('#rate').value), geminiKey: $('#gemini-key').value.trim(), typesafeKey: $('#typesafe-key').value.trim(), ...extra };
}
async function save(extra = {}) { const result = await api.saveSettings(settingsInput(extra)); fillSettings(result); notice('Connections saved on this Mac.', false); }
async function control(action, index) {
  if (['focus_next', 'focus_previous'].includes(action)) {
    const version = navigationVersion;
    navigation = navigation.then(async () => {
      if (version !== navigationVersion) return;
      stopPlayback(); await attempt(async () => render(await api.control(action, index)));
    });
    return navigation;
  }
  navigationVersion++;
  if (action === 'stop') { navigation = Promise.resolve(); cancelRecording(); }
  stopPlayback();
  await attempt(async () => render(await api.control(action, index)));
}
function stopPlayback() {
  playback++;
  api.stopLocalSpeech().catch(() => {});
  if (cloudPlayback) {
    cloudPlayback.player.stop(); api.stopSpeechStream(cloudPlayback.id).catch(() => {}); cloudPlayback = null;
  }
  $('#speaking-indicator').hidden = true;
}
api.onSpeechChunk(({ id, chunk }) => {
  if (cloudPlayback?.id === id) cloudPlayback.player.push(chunk);
});
async function playCloudPassage(text, language, epoch, token) {
  const job = { id: crypto.randomUUID(), player: new PcmPlayer({ rate: Number($('#rate').value) }) };
  cloudPlayback = job;
  try {
    await job.player.start();
    if (token !== playback) return false;
    const synthesis = api.streamSpeech({ id: job.id, text, language, epoch }).then(result => {
      if (result.completed) job.player.finish(); else job.player.stop();
      return result;
    });
    const [result, completed] = await Promise.all([synthesis, job.player.done]);
    return result.completed && completed && token === playback;
  } finally {
    job.player.stop(); api.stopSpeechStream(job.id).catch(() => {});
    if (cloudPlayback === job) cloudPlayback = null;
  }
}
async function speak(request) {
  stopPlayback();
  if (!settings.speechEnabled || recording.active) return;
  const token = playback;
  try {
    const route = await api.speechRoute({ text: request.text, language: request.language, epoch: request.epoch });
    if (token !== playback) return;
    if (route.local) {
      $('#speaking-indicator').hidden = false;
      const completed = await api.speakLocal({ text: request.text, language: request.language, epoch: request.epoch });
      if (token !== playback || !completed) return;
    } else {
      if (request.practice) return;
      for (const text of splitForSpeech(request.text)) {
        if (token !== playback) return;
        $('#speaking-indicator').hidden = false;
        if (!await playCloudPassage(text, speechLocale(route.language, text), request.epoch, token)) return;
      }
    }
    $('#speaking-indicator').hidden = true;
    if (request.batch) {
      await attempt(async () => render(await api.continueReading(request.epoch, request.batch.index)));
    } else if (request.reading && $('#continuous').checked && currentView === 'reader' && !state.pending && state.reader.index < state.reader.items.length - 1 && state.reader.index >= 0) {
      await control('next');
    }
  } catch (e) {
    if (token === playback) { stopPlayback(); notice(`Speech could not play: ${e.message}`); }
  }
}
function tone(frequency = 660) {
  try {
    const ctx = new AudioContext(), oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.value = .05;
    oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .14);
    oscillator.stop(ctx.currentTime + .15); oscillator.onended = () => ctx.close();
  } catch {}
}
const recording = new HoldRecorder({
  prepare: async () => {
    stopPlayback(); await api.control('stop');
    if (!await api.microphonePermission()) throw new Error('Allow microphone access for Svara in macOS System Settings → Privacy & Security → Microphone.');
  },
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
  createRecorder: stream => {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This version of the app cannot record audio.');
    return new MediaRecorder(stream, { mimeType });
  },
  onState: status => {
    const listening = status === 'recording';
    document.body.classList.toggle('recording', listening);
    $('#talk').setAttribute('aria-pressed', String(listening));
    $('#talk-label').textContent = listening ? 'Release to send' : status === 'preparing' ? 'Getting microphone ready…' : 'Hold to speak';
    $('#recording-hint').textContent = listening ? 'Listening… Release to send, or Escape to cancel. Maximum 45 seconds.'
      : status === 'preparing' ? 'Keep holding. Start speaking when you hear the tone.'
      : 'Hold your speaking key or this button. Speak after the tone, then release to send.';
    if (listening) { tone(); $('#status-message').textContent = 'Listening to your command.'; }
    if (status === 'sending') tone(440);
  },
  submit: async bytes => render(await api.audio(bytes)),
  onError: error => notice(error.message)
});
function cancelRecording() { recording.cancel(); }
function startRecording(source) {
  if (state.practice) { notice('Practice mode uses typed commands. Switch to live browsing to use your microphone.'); return; }
  if (!settings.projectId) { view('settings'); notice('Add your Google Cloud project and credentials to use speech recognition.'); return; }
  recording.start(source);
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => view(button.dataset.view));
$('.brand').onclick = event => { event.preventDefault(); view('home'); };
document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => control(button.dataset.action));
document.querySelectorAll('[data-site]').forEach(button => button.onclick = () => attempt(async () => { view('reader'); render(await api.openSite(button.dataset.site)); }));
const scopes = { results: 'show_results', headings: 'show_headings', article: 'show_page', links: 'show_links' };
document.querySelectorAll('[data-scope]').forEach(button => button.onclick = () => control(scopes[button.dataset.scope]));
$('#refresh-reader').onclick = () => control(scopes[state.reader.scope]);
$('#open-item').onclick = () => control('open_item', state.reader.index);
$('#translate-item').onclick = () => control(state.reader.language === 'original' ? 'read_sinhala' : 'read_original');
$('#command-form').onsubmit = event => {
  event.preventDefault(); const text = $('#command-input').value.trim(); if (!text) return;
  $('#command-input').value = ''; stopPlayback(); attempt(async () => render(await api.command(text)));
};
$('#settings-form').onsubmit = event => { event.preventDefault(); attempt(() => save()); };
$('#choose-credentials').onclick = () => attempt(async () => { const data = await api.chooseCredentials(); settings.credentialFile = data.credentialFile; $('#credential-file').textContent = data.credentialFile ? `Selected file: ${data.credentialFile}` : 'Using default Google credentials.'; });
$('#check-connections').onclick = () => attempt(async () => {
  const button = $('#check-connections'); button.disabled = true;
  try {
    await save(); $('#connection-results').textContent = 'Testing listening, speaking, translation, and browser decisions…';
    const results = await api.checkConnections();
    $('#connection-results').replaceChildren(...results.map(item => {
      const div = document.createElement('div'); div.classList.toggle('failed', !item.ok);
      div.textContent = item.ok ? `✓ ${item.name}: ${item.detail}` : `○ ${item.detail}`; return div;
    }));
  } catch (error) {
    $('#connection-results').textContent = 'Connection checks did not finish. Please try again.';
    throw error;
  } finally { button.disabled = false; }
});
$('#voice-test').onclick = () => attempt(async () => { await save(); render(await api.voiceTest()); });
$('#clear-keys').onclick = () => attempt(() => save({ clearKeys: true, geminiKey: '', typesafeKey: '' }));
const talk = $('#talk');
talk.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  talk.setPointerCapture(event.pointerId); startRecording(`pointer-${event.pointerId}`);
});
talk.addEventListener('pointerup', event => recording.finish(`pointer-${event.pointerId}`));
talk.addEventListener('pointercancel', cancelRecording);
talk.addEventListener('lostpointercapture', event => recording.finish(`pointer-${event.pointerId}`));
talk.addEventListener('keydown', event => {
  if (!['Space', 'Enter'].includes(event.code)) return;
  event.preventDefault(); if (!event.repeat) startRecording(`button-${event.code}`);
});
document.addEventListener('keyup', event => {
  if (['Space', 'Enter'].includes(event.code) && recording.session?.source === `button-${event.code}`) {
    event.preventDefault(); recording.finish(`button-${event.code}`);
  }
});
// Pointer or focused-button holds cannot continue after focus is lost.
window.addEventListener('blur', () => {
  if (recording.session && recording.session.source !== 'shortcut') cancelRecording();
});
window.addEventListener('beforeunload', cancelRecording);
talk.addEventListener('click', event => {
  if (event.detail === 0 && !recording.active) notice('Hold Space or Enter on this button, or hold your speaking shortcut. Release to send.', false);
});
$('#stop-all').onclick = () => control('stop');
for (const id of ['#practice', '#reader-practice']) $(id).onclick = () => attempt(async () => { stopPlayback(); render(await api.startBrowser(true)); await focusReader(); });
$('#live-mode').onclick = () => attempt(async () => { stopPlayback(); render(await api.startBrowser(false)); });
$('#show-browser').onclick = () => attempt(() => api.showBrowser());
$('#rate').oninput = () => { const rate = Number($('#rate').value); $('#rate-value').textContent = rate.toFixed(1) + '×'; };
$('#rate').onchange = () => attempt(async () => { settings = await api.saveSettings(settingsInput()); });
$('#read-on-focus').onchange = () => attempt(async () => {
  const value = $('#read-on-focus').checked;
  try { settings = await api.readerPreference(value); }
  catch (error) { $('#read-on-focus').checked = settings.readOnFocus !== false; throw error; }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && currentView !== 'shortcuts') { event.preventDefault(); control('stop'); return; }
  if (currentView !== 'reader' || recording.active || state.pending || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const element = document.activeElement;
  if (!element?.closest('#reading-list') && !['main', 'page-title'].includes(element?.id)) return;
  const action = { ArrowDown: 'focus_next', ArrowRight: 'focus_next', ArrowUp: 'focus_previous', ArrowLeft: 'focus_previous', Enter: 'open_current', r: 'repeat', R: 'repeat' }[event.key];
  if (action) { event.preventDefault(); if (!event.repeat) control(action); }
});
api.onState(render); api.onTabs(renderTabs); api.onNarration(speak); api.onStop(stopPlayback);
api.onNavigationTone(() => { if (settings.speechEnabled && !recording.active) tone(); });
api.onReaderPosition(({ number, epoch }) => {
  if (!settings.speechEnabled || recording.active || ['settings', 'shortcuts'].includes(currentView)) return;
  attempt(() => api.speakPosition(number, epoch));
});
api.onReaderFocus(data => { focusReader(data).catch(error => notice(error.message)); });
api.onNotice(data => { notice(data.text, data.error); if (data.error) tone(220); }); api.onNavigate(view); api.onCancelRecording(cancelRecording);
api.onShortcut(action => {
  if (currentView === 'shortcuts') return;
  if (action === 'stop') { control('stop'); return; }
  if (action === 'speak-end') { recording.finish('shortcut'); return; }
  if (action === 'speak-cancel' || action === 'speak-unavailable') {
    cancelRecording();
    if (action === 'speak-unavailable') notice('The speaking key could not be tracked. Restart Svara, or hold the speaking button.');
    return;
  }
  if (action === 'speak-start') { startRecording('shortcut'); return; }
  if (action === 'media-unavailable') { notice('The media key could not be tracked. Restart Svara, or use the Play and Pause buttons.'); return; }
  const controls = { open: 'open_current', read: 'repeat', next: 'focus_next', previous: 'focus_previous',
    results: 'show_results', headings: 'show_headings', page_text: 'show_page', links: 'show_links',
    first_five: 'read_first_five', read_sinhala: 'read_sinhala', read_original: 'read_original', media_toggle: 'media_toggle' };
  if (!controls[action]) return;
  if (recording.active) { notice('Finish speaking before using the reading shortcuts.'); return; }
  if (state.pending) { notice('Confirm or cancel the pending choice before using the reading shortcuts.'); return; }
  control(controls[action]);
});
await attempt(async () => { await api.editShortcuts(false); const initial = await api.initial(); fillSettings(initial.settings); render(initial.state); renderTabs(initial.tabs); renderChrome(initial.chrome); if (initial.shortcutWarning) notice(initial.shortcutWarning); });
