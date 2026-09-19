import { BrowserController } from './browser.js';
import { safeUrl, searchUrl } from '../core/policy.js';

export class ConnectedBrowser {
  constructor({ bridge, openChrome, onChange, ...options }) {
    this.bridge = bridge; this.openChrome = openChrome; this.onChange = onChange;
    this.practice = false; this.started = false; this.manualPage = false;
    this.sample = new BrowserController({ ...options, onChange: () => { if (this.practice) onChange(); } });
    bridge.on('changed', () => { if (!this.practice && this.started) onChange(); });
    bridge.on('connection', () => { if (!this.practice && this.started) onChange(); });
  }
  get active() { return this.practice ? this.sample.active : this.started && this.bridge.connected; }
  async ensure() {
    if (!this.bridge.connected) { await this.openChrome(); await this.bridge.wait(); }
    this.started = true;
  }
  async startLive() {
    if (this.practice) await this.sample.close();
    this.practice = false; await this.ensure();
    const snapshot = await this.bridge.request('start'); this.manualPage = Boolean(snapshot.manual); return snapshot;
  }
  async startPractice() { this.practice = true; this.manualPage = false; return this.sample.startPractice(); }
  async snapshot() {
    if (this.practice) return this.sample.snapshot();
    await this.ensure(); const snapshot = await this.bridge.request('snapshot');
    this.manualPage = Boolean(snapshot.manual); if (snapshot.closed) this.started = false; return snapshot;
  }
  async tabs() { return this.practice ? this.sample.tabs() : this.bridge.connected ? this.bridge.request('tabs') : []; }
  async show() { if (this.practice) return this.sample.show(); await this.ensure(); return this.bridge.request('show'); }
  async isCurrent(snapshot) {
    if (this.practice) return this.sample.isCurrent(snapshot);
    const fresh = await this.snapshot(); return fresh.tabId === snapshot.tabId && fresh.pageId === snapshot.pageId && fresh.url === snapshot.url;
  }
  async verifyTarget(target, snapshot) {
    if (this.practice) return this.sample.verifyTarget(target, snapshot);
    return this.bridge.request('verify', { target, snapshot: this.reference(snapshot) });
  }
  reference(snapshot) { return { tabId: snapshot.tabId, pageId: snapshot.pageId, url: snapshot.url }; }
  async activate(target, snapshot, text, signal) {
    if (this.practice) return this.sample.activate(target, snapshot, text, signal);
    signal?.throwIfAborted();
    return this.bridge.request('activate', { target, snapshot: this.reference(snapshot), text }, signal);
  }
  async execute(action, command = {}, signal) {
    if (this.practice) return this.sample.execute(action, command);
    await this.ensure(); signal?.throwIfAborted();
    const args = { action };
    if (['navigate', 'search'].includes(action)) {
      const homes = { youtube: 'https://www.youtube.com', wikipedia: 'https://en.wikipedia.org', google: 'https://www.google.com' };
      args.action = 'navigate'; args.url = action === 'search' ? searchUrl(command.site, command.payload) : safeUrl(command.url || homes[command.site] || '');
    }
    return this.bridge.request('execute', args, signal);
  }
  async switchTab(id, signal) { return this.practice ? this.sample.switchTab(id) : this.bridge.request('switch_tab', { id }, signal); }
  async loadMore(snapshot, scope, signal, allowNextPage = true) {
    if (this.practice) return this.sample.loadMore(snapshot, scope, signal, allowNextPage);
    signal?.throwIfAborted();
    if (!await this.isCurrent(snapshot)) throw new Error('The page changed. Refresh the reading list.');
    const old = new Set((snapshot[scope] || []).map(item => `${item.href || item.id}|${item.text}`));
    const request = { ...this.reference(snapshot), pagination: snapshot.pagination, [scope]: (snapshot[scope] || []).slice(-1) };
    const result = await this.bridge.request('load_more', { snapshot: request, scope, allowNextPage }, signal);
    if (result.deferred) return { snapshot, deferred: true };
    const deadline = Date.now() + 5000;
    let fresh = snapshot;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      await new Promise(resolve => setTimeout(resolve, 180)); signal?.throwIfAborted();
      fresh = await this.snapshot(); signal?.throwIfAborted();
      if ((fresh[scope] || []).some(item => !old.has(`${item.href || item.id}|${item.text}`))) return { snapshot: fresh, changed: true };
    }
    return { snapshot: fresh, changed: fresh.pageId !== snapshot.pageId || fresh.url !== snapshot.url };
  }
  async close() { await this.sample.close(); await this.bridge.close(); }
}
