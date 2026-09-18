import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectPage } from './snapshot.js';
import { safeUrl, searchUrl } from '../core/policy.js';

export class BrowserController {
  constructor({ directory, onChange = () => {}, headless = false, practiceDirectory }) {
    this.directory = directory; this.onChange = onChange; this.headless = headless;
    this.context = null; this.active = null; this.practice = false; this.launching = null;
    this.practiceUrl = pathToFileURL(practiceDirectory ? path.join(practiceDirectory, 'index.html') : fileURLToPath(new URL('../practice/index.html', import.meta.url))).href;
    this.pageIds = new WeakMap(); this.nextTabId = 1;
  }
  async ensure() {
    if (this.context) return;
    if (this.launching) return this.launching;
    this.launching = this.launch();
    try { await this.launching; } finally { this.launching = null; }
  }
  async launch() {
    const options = { headless: this.headless, viewport: null, acceptDownloads: false, chromiumSandbox: true,
      ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain', '--disable-client-side-phishing-detection', '--unsafely-disable-devtools-self-xss-warnings', '--disable-popup-blocking'],
      args: ['--start-maximized'] };
    const bundled = chromium.executablePath();
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(chrome)) options.executablePath = chrome;
    else if (fs.existsSync(bundled)) options.executablePath = bundled;
    else throw new Error('Google Chrome is required. Install Chrome, or run npm run browser:install from this project.');
    this.context = await chromium.launchPersistentContext(path.join(this.directory, this.practice ? 'practice-profile' : 'browser-profile'), options);
    this.context.setDefaultTimeout(6000);
    this.context.setDefaultNavigationTimeout(25000);
    this.context.on('close', () => { this.context = null; this.active = null; this.onChange(); });
    const attach = page => {
      this.pageIds.set(page, this.nextTabId++); this.active = page;
      page.on('domcontentloaded', () => this.onChange());
      page.on('close', () => { if (this.active === page) this.active = this.context?.pages().find(p => !p.isClosed()) || null; this.onChange(); });
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      page.on('download', download => download.cancel().catch(() => {}));
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) this.onChange(); });
      this.onChange();
    };
    this.context.on('page', attach);
    this.context.pages().forEach(attach);
    if (!this.active) await this.context.newPage();
  }
  async page() { await this.ensure(); if (!this.active || this.active.isClosed()) this.active = await this.context.newPage(); return this.active; }
  async tabs() {
    if (!this.context) return [];
    return Promise.all(this.context.pages().filter(p => !p.isClosed()).map(async p => ({ id: this.pageIds.get(p), title: await p.title().catch(() => 'New tab'), url: p.url(), active: p === this.active })));
  }
  async show() { const p = await this.page(); await p.bringToFront(); }
  async startPractice() {
    if (!this.practice && this.context) await this.close();
    this.practice = true; const p = await this.page();
    await p.goto(this.practiceUrl); return this.snapshot();
  }
  async startLive() {
    if (this.practice && this.context) await this.close();
    this.practice = false; await this.page(); return this.snapshot();
  }
  async snapshot() { return (await this.page()).evaluate(collectPage); }
  async isCurrent(snapshot) {
    if (!this.active || this.active.isClosed() || this.active.url() !== snapshot.url) return false;
    return this.active.evaluate(() => window.__svaraDocument?.id).catch(() => null).then(id => id === snapshot.pageId);
  }
  async verifyTarget(target, snapshot) {
    if (!await this.isCurrent(snapshot)) throw new Error('The page changed. Refresh the reading list before choosing an item.');
    const fresh = await this.snapshot();
    const found = fresh.elements.find(e => e.id === target.id);
    if (!found || found.text !== (target.targetText || target.text) || found.href !== target.href || found.role !== target.role) {
      throw new Error('That item changed or disappeared. Refresh the reading list and choose it again.');
    }
    return (await this.page()).locator(`[data-svara-id="${found.id}"]`);
  }
  async activate(target, snapshot, text) {
    const element = await this.verifyTarget(target, snapshot);
    if (text !== undefined) {
      if (!target.editable || target.type === 'password') throw new Error('Choose an ordinary text field. Password entry is not supported.');
      await element.fill(text);
      const actual = await element.evaluate(el => el.isContentEditable ? el.textContent : el.value);
      if (actual !== text) throw new Error('The field did not keep the dictated text. Please check it before continuing.');
      return { title: target.text, effect: 'filled' };
    }
    if (target.role === 'link' && !this.practice) safeUrl(target.href);
    await element.click();
    const p = await this.page();
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    return { title: await p.title(), effect: 'activated' };
  }
  async execute(action, command = {}) {
    const p = await this.page();
    if (['navigate', 'search'].includes(action)) {
      if (this.practice) throw new Error('This is the sample page. Switch to live browsing to visit websites.');
      const homes = { youtube: 'https://www.youtube.com', wikipedia: 'https://en.wikipedia.org', google: 'https://www.google.com' };
      const url = action === 'search' ? searchUrl(command.site, command.payload) : safeUrl(command.url || homes[command.site] || '');
      await p.goto(url, { waitUntil: 'domcontentloaded' });
    } else if (action === 'new_tab') { this.active = await this.context.newPage(); }
    else if (action === 'close_tab') {
      if (this.context.pages().length === 1) await this.context.newPage();
      await p.close();
    } else if (action === 'next_tab' || action === 'previous_tab') {
      const pages = this.context.pages(); const index = pages.indexOf(p);
      this.active = pages[(index + (action === 'next_tab' ? 1 : -1) + pages.length) % pages.length];
      await this.active.bringToFront();
    } else if (action === 'back' || action === 'forward') {
      const response = action === 'back' ? await p.goBack({ waitUntil: 'domcontentloaded' }) : await p.goForward({ waitUntil: 'domcontentloaded' });
      if (!response) return { note: 'There may be no further page in this direction.' };
    } else if (action === 'reload') await p.reload({ waitUntil: 'domcontentloaded' });
    else if (action === 'scroll_down' || action === 'scroll_up') {
      await p.evaluate(direction => window.scrollBy({ top: innerHeight * 0.8 * direction, behavior: 'instant' }), action === 'scroll_down' ? 1 : -1);
    } else if (action === 'play' || action === 'pause') {
      const status = await p.evaluate(async shouldPlay => {
        const media = document.querySelector('video,audio');
        if (!media) return 'missing';
        if (shouldPlay) await media.play(); else media.pause();
        return media.paused ? 'paused' : 'playing';
      }, action === 'play');
      if (status === 'missing') throw new Error('There is no playable video or audio on this page.');
      if (status !== (action === 'play' ? 'playing' : 'paused')) throw new Error('Playback did not change. The website may need an extra selection.');
    } else throw new Error('That browser action is not available.');
    return this.snapshot();
  }
  async switchTab(id) {
    const p = this.context?.pages().find(p => this.pageIds.get(p) === id);
    if (!p) throw new Error('That tab has closed.');
    this.active = p; await p.bringToFront(); return this.snapshot();
  }
  async close() { if (this.context) await this.context.close(); this.context = null; this.active = null; }
}
