import { splitForSpeech, speechLocale } from './audio.js';
import { DEFAULT_SHORTCUTS, shortcutLabel } from '../core/shortcuts.js';
import { createShortcutEditor } from './shortcuts.js';
const api = window.svara;
const $ = selector => document.querySelector(selector);
let state, settings, currentView = 'home', tabs = [], recorder = null, stream = null, recordingTimer, discarded = false;
let recordingPending = false, audio = null, audioUrl = '', playback = 0, activeResolve = null, noticeTimer;
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
  $('#list-count').textContent = `${next.reader.items.length} items`;
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
      button.setAttribute('aria-current', String(index === next.reader.index));
      button.setAttribute('aria-label', `Read item ${index + 1}: ${item.text}`);
      const number = document.createElement('span'); number.className = 'item-number'; number.textContent = index + 1;
      const words = document.createElement('span'), title = document.createElement('strong'); title.textContent = item.text; title.lang = item.language || '';
      words.append(title);
      if (item.meta) { const meta = document.createElement('small'); meta.textContent = item.meta; words.append(meta); }
      button.append(number, words); button.addEventListener('click', () => control('select', index)); li.append(button); return li;
    }));
    if (focusedIndex !== undefined) list.querySelector(`[data-item-index="${focusedIndex}"]`)?.focus({ preventScroll: true });
  }
  const item = next.reader.items[next.reader.index];
  $('#current-text').textContent = item?.text || 'Your selected item will appear here.';
  $('#current-text').lang = item?.language || 'en';
  $('#current-meta').textContent = item?.meta || '';
  $('#position').textContent = item ? `${next.reader.index + 1} / ${next.reader.items.length}` : '—';
  $('#open-item').disabled = !item?.targetId;
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
function fillSettings(data) {
  settings = data;
  for (const [selector, key] of Object.entries({ '#project-id': 'projectId', '#region': 'region', '#input-language': 'inputLanguage', '#voice': 'voice', '#guidance-language': 'guidanceLanguage', '#rate': 'rate' })) $(selector).value = data[key];
  $('#speech-enabled').checked = data.speechEnabled;
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
  for (const [selector, action] of Object.entries({ '#talk': 'speak', '[data-action="next"]': 'next', '[data-action="previous"]': 'previous', '#open-item': 'open' })) {
    const button = $(selector), key = shortcuts.enabled && shortcuts.bindings[action];
    button.title = key ? shortcutLabel(key) : 'Choose a key in Keyboard shortcuts';
  }
  if (data.warning) notice(data.warning);
}
function settingsInput(extra = {}) {
  return { projectId: $('#project-id').value.trim(), region: $('#region').value, inputLanguage: $('#input-language').value,
    voice: $('#voice').value, guidanceLanguage: $('#guidance-language').value, speechEnabled: $('#speech-enabled').checked,
    rate: Number($('#rate').value), geminiKey: $('#gemini-key').value.trim(), typesafeKey: $('#typesafe-key').value.trim(), ...extra };
}
async function save(extra = {}) { const result = await api.saveSettings(settingsInput(extra)); fillSettings(result); notice('Connections saved on this Mac.', false); }
async function control(action, index) {
  if (action === 'stop') cancelRecording();
  stopPlayback();
  await attempt(async () => render(await api.control(action, index)));
}
function stopPlayback() {
  playback++;
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  if (activeResolve) { activeResolve(); activeResolve = null; }
  $('#speaking-indicator').hidden = true;
}
async function speak(request) {
  stopPlayback();
  if (request.practice || !settings.speechEnabled || recorder?.state === 'recording') return;
  const token = playback;
  try {
    for (const text of splitForSpeech(request.text)) {
      if (token !== playback) return;
      const base64 = await api.synthesize({ text, language: speechLocale(request.language, text), epoch: request.epoch });
      if (!base64 || token !== playback) return;
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      audioUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })); audio = new Audio(audioUrl);
      audio.playbackRate = Number($('#rate').value);
      $('#speaking-indicator').hidden = false;
      await new Promise((resolve, reject) => {
        activeResolve = resolve; audio.onended = resolve; audio.onerror = () => reject(new Error('The audio could not be played. Try reading the item again.'));
        audio.play().catch(reject);
      });
      if (token !== playback) return;
      URL.revokeObjectURL(audioUrl); audioUrl = ''; audio = null; activeResolve = null;
    }
    $('#speaking-indicator').hidden = true;
    if (request.reading && $('#continuous').checked && currentView === 'reader' && !state.pending && state.reader.index < state.reader.items.length - 1 && state.reader.index >= 0) {
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
function resetRecordingUi() {
  clearTimeout(recordingTimer); document.body.classList.remove('recording');
  $('#talk-label').textContent = 'Start speaking'; $('#talk').setAttribute('aria-pressed', 'false');
  $('#recording-hint').textContent = 'Speak in Sinhala or English. Press again when you’re done.';
}
function cancelRecording() {
  discarded = true;
  if (recorder?.state === 'recording') recorder.stop();
  stream?.getTracks().forEach(track => track.stop()); stream = null; resetRecordingUi();
}
async function toggleRecording() {
  if (recordingPending) return;
  if (recorder?.state === 'recording') { recorder.stop(); tone(440); return; }
  if (state.practice) { notice('Practice mode uses typed commands. Switch to live browsing to use your microphone.'); return; }
  if (!settings.projectId) { view('settings'); notice('Add your Google Cloud project and credentials to use speech recognition.'); $('#project-id').focus(); return; }
  recordingPending = true; stopPlayback();
  try {
    await api.control('stop');
    const permitted = await api.microphonePermission();
    if (!permitted) throw new Error('Allow microphone access for Svara in macOS System Settings → Privacy & Security → Microphone.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const type = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!type) throw new Error('This version of the app cannot record audio.');
    recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks = []; discarded = false;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      stream?.getTracks().forEach(track => track.stop()); stream = null; resetRecordingUi();
      if (discarded) return;
      const blob = new Blob(chunks, { type });
      if (blob.size < 1000) { notice('That recording was very short. Please try again.'); return; }
      await attempt(async () => render(await api.audio(new Uint8Array(await blob.arrayBuffer()))));
    };
    recorder.onerror = () => { cancelRecording(); notice('The microphone stopped unexpectedly. Please try again.'); };
    tone(); recorder.start(250);
    document.body.classList.add('recording'); $('#talk-label').textContent = 'Finish speaking'; $('#talk').setAttribute('aria-pressed', 'true');
    $('#recording-hint').textContent = 'Listening… Press again to send, or Escape to cancel. Maximum 45 seconds.';
    $('#status-message').textContent = 'Listening to your command.';
    recordingTimer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 45000);
  } catch (e) { cancelRecording(); notice(e.message); }
  finally { recordingPending = false; }
}

document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => view(button.dataset.view));
$('.brand').onclick = event => { event.preventDefault(); view('home'); };
document.querySelectorAll('[data-action]').forEach(button => button.onclick = () => control(button.dataset.action));
document.querySelectorAll('[data-site]').forEach(button => button.onclick = () => attempt(async () => { view('reader'); render(await api.openSite(button.dataset.site)); }));
const scopes = { results: 'read_results', headings: 'read_headings', article: 'read_page', links: 'read_links' };
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
$('#talk').onclick = toggleRecording;
$('#stop-all').onclick = () => control('stop');
for (const id of ['#practice', '#reader-practice']) $(id).onclick = () => attempt(async () => { stopPlayback(); render(await api.startBrowser(true)); view('reader'); });
$('#live-mode').onclick = () => attempt(async () => { stopPlayback(); render(await api.startBrowser(false)); });
$('#show-browser').onclick = () => attempt(() => api.showBrowser());
$('#rate').oninput = () => { const rate = Number($('#rate').value); $('#rate-value').textContent = rate.toFixed(1) + '×'; if (audio) audio.playbackRate = rate; };
$('#rate').onchange = () => attempt(async () => { settings = await api.saveSettings(settingsInput()); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && currentView !== 'shortcuts') { event.preventDefault(); control('stop'); } });
api.onState(render); api.onTabs(renderTabs); api.onNarration(speak); api.onStop(stopPlayback);
api.onNotice(data => { notice(data.text, data.error); if (data.error) tone(220); }); api.onNavigate(view); api.onCancelRecording(cancelRecording);
api.onShortcut(action => {
  if (currentView === 'shortcuts') return;
  if (action === 'speak') { toggleRecording(); return; }
  if (!['next', 'previous', 'open'].includes(action)) return;
  if (recorder?.state === 'recording' || recordingPending) { notice('Finish speaking before using the reading shortcuts.'); return; }
  if (state.pending) { notice('Confirm or cancel the pending choice before using the reading shortcuts.'); return; }
  control(action === 'open' ? 'open_current' : action);
});
await attempt(async () => { await api.editShortcuts(false); const initial = await api.initial(); fillSettings(initial.settings); render(initial.state); renderTabs(initial.tabs); if (initial.shortcutWarning) notice(initial.shortcutWarning); });
