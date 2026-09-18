const { contextBridge, ipcRenderer } = require('electron');
const call = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const subscribe = (channel, listener) => {
  const handler = (_event, data) => listener(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('svara', {
  initial: () => call('initial'), saveSettings: input => call('settings-save', input),
  saveShortcuts: input => call('shortcuts-save', input), editShortcuts: value => call('shortcuts-editing', value),
  chooseCredentials: () => call('credentials-file'), checkConnections: () => call('connections-check'),
  startBrowser: practice => call('start-browser', practice), showBrowser: () => call('show-browser'),
  command: text => call('command', text), control: (action, index) => call('control', action, index),
  openSite: site => call('open-site', site), microphonePermission: () => call('microphone-permission'),
  audio: data => call('audio', data), synthesize: request => call('synthesize', request), voiceTest: () => call('voice-test'),
  onState: cb => subscribe('state', cb), onTabs: cb => subscribe('tabs', cb), onNarration: cb => subscribe('narration', cb),
  onStop: cb => subscribe('stop', cb), onNotice: cb => subscribe('notice', cb), onNavigate: cb => subscribe('navigate', cb),
  onShortcut: cb => subscribe('shortcut-action', cb), onCancelRecording: cb => subscribe('cancel-recording', cb)
});
