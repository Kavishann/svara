const status = document.querySelector('#status');
async function connect() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'connect' });
    status.textContent = result?.connected ? 'Connected. Your Svara controls are ready.' : 'Open Svara, then choose Connect to Svara. Your Chrome extension is installed.';
    // The app opens this temporary tab to wake the companion after a restart.
    // Only that tab closes; existing browsing tabs are never touched.
    if (result?.connected && location.hash === '#reconnect') {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id) await chrome.tabs.remove(tab.id);
    }
    return result?.connected;
  } catch { status.textContent = 'Reconnect the extension from Svara → Connections → Set up Chrome.'; }
}
document.querySelector('#connect').onclick = connect;
connect();
let attempts = 0;
const timer = setInterval(async () => { if (await connect() || ++attempts >= 15) clearInterval(timer); }, 1000);
