import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserController } from '../src/browser/browser.js';
import { Engine } from '../src/core/engine.js';

const until = async predicate => {
  const end = Date.now() + 7000;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(predicate(), 'Expected live reader update before timeout');
};
const titles = (start, count) => Array.from({ length: count }, (_, i) => `<h3><a href="/item-${start + i}">Title ${start + i}</a></h3>`).join('');

test('live Chrome reader follows navigation, AJAX replacement/appends, load-more and next-page controls', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-live-'));
  let engine;
  const browser = new BrowserController({ directory, headless: true, onChange: () => engine?.browserChanged() });
  const spoken = [], focused = [];
  const settings = { guidanceLanguage: 'en-US', readOnFocus: true };
  engine = new Engine({ browser, google: {}, settings: () => settings });
  engine.on('narration', value => spoken.push(value)); engine.on('reader-focus', value => focused.push(value));
  try {
    await browser.ensure();
    await browser.context.route('https://reader.test/**', route => {
      const url = new URL(route.request().url());
      let content = titles(1, 3);
      if (url.pathname === '/load') content += `<button onclick="document.querySelector('main').insertAdjacentHTML('beforeend', '${titles(4, 2).replaceAll('"', '&quot;')}');this.remove()">Load more results</button>`;
      if (url.pathname === '/scroll') content += `<style>main{min-height:2500px}</style><script>addEventListener('scroll', () => document.querySelector('main').insertAdjacentHTML('beforeend', '${titles(4, 2)}'), {once:true})</script>`;
      if (url.pathname === '/paged') content += '<nav aria-label="Pagination"><a href="/page-two" rel="next">Next</a></nav>';
      if (url.pathname === '/page-two') content = titles(4, 3);
      if (url.pathname.startsWith('/item-')) content = '<h1>Opened article</h1><p>This article is ready for reading.</p>';
      return route.fulfill({ contentType: 'text/html', body: `<html lang="en"><title>${url.pathname}</title><main>${content}</main></html>` });
    });
    const page = await browser.page();
    await page.goto('https://reader.test/start');
    await until(() => engine.reader.items.length === 3);
    assert.equal(engine.reader.index, 0); assert.equal(spoken.at(-1).text, '1. Title 1'); assert.equal(focused.at(-1).raise, true);
    await engine.control('focus_next'); assert.equal(engine.reader.index, 1);
    const beforeAppend = spoken.length;
    await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), titles(4, 2));
    await until(() => engine.reader.items.length === 5);
    assert.equal(engine.reader.index, 1); assert.equal(spoken.length, beforeAppend, 'appending does not restart reading');
    // An AJAX re-render creates new element IDs; the chosen link must stay selected.
    await page.locator('main').evaluate((el, html) => el.innerHTML = html, titles(1, 6));
    await until(() => engine.reader.items.length === 6);
    assert.equal(engine.reader.current().text, 'Title 2');
    await page.locator('main').evaluate((el, html) => el.innerHTML = html, titles(21, 3));
    await until(() => engine.reader.current()?.text === 'Title 21');
    assert.equal(engine.reader.index, 0); assert.equal(spoken.at(-1).text, '1. Title 21');
    await engine.control('open_current');
    assert.equal(page.url(), 'https://reader.test/item-21');
    assert.equal(engine.reader.current().text, 'Opened article');
    // Empty/loading headings are replaced with real result titles as they arrive.
    await page.locator('main').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), titles(31, 3));
    await until(() => engine.reader.scope === 'results');
    assert.equal(engine.reader.current().text, 'Title 31');
    settings.readOnFocus = false;
    const beforeQuiet = spoken.length;
    await engine.control('focus_next'); assert.equal(engine.reader.index, 1); assert.equal(spoken.length, beforeQuiet);
    await engine.control('repeat'); assert.equal(spoken.at(-1).text, '2. Title 32');
    await page.goto('https://reader.test/load');
    await until(() => engine.snapshot.url.endsWith('/load'));
    await engine.control('focus_item', 2);
    await until(() => engine.reader.items.length === 5);
    assert.equal(engine.reader.index, 2, 'loading more keeps the last selected title');
    await engine.control('focus_next'); assert.equal(engine.reader.current().text, 'Title 4');
    await page.goto('https://reader.test/paged');
    await until(() => engine.snapshot.url.endsWith('/paged'));
    await engine.control('focus_item', 2);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(page.url(), 'https://reader.test/paged', 'next page is not opened until the user moves past the end');
    await engine.control('focus_next');
    assert.equal(page.url(), 'https://reader.test/page-two'); assert.equal(engine.reader.current().text, 'Title 4');
    assert.equal(engine.reader.index, 0);
    await page.goto('https://reader.test/scroll');
    await until(() => engine.snapshot.url.endsWith('/scroll'));
    await engine.control('focus_item', 2);
    await until(() => engine.reader.items.length === 5);
    assert.equal(engine.reader.index, 2, 'scroll-loaded items preserve selection');
    await engine.control('focus_next'); assert.equal(engine.reader.current().text, 'Title 4');
    const beforeNewPage = spoken.length;
    await page.goto('https://reader.test/start');
    await until(() => engine.snapshot.url.endsWith('/start'));
    assert.equal(engine.reader.index, 0); assert.equal(spoken.length, beforeNewPage, 'manual-read preference applies on navigation');
  } finally { engine.stop(); await browser.close(); engine.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('YouTube keeps only video titles, and a title beyond Jev’s candidate limit still opens', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-titles-'));
  const browser = new BrowserController({ directory, headless: true });
  try {
    await browser.ensure();
    await browser.context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: `<html lang="en"><title>Videos</title><main>${Array.from({ length: 180 }, (_, i) => `<h3><a id="video-title" href="/watch?v=${i}" title="Video ${i}" aria-label="Video ${i} by Loud Channel with 4 million views">Video ${i}</a></h3><a href="/@channel">Loud Channel</a>`).join('')}<yt-lockup-view-model><h3><a href="/watch?v=modern" aria-label="Modern title by Another Channel">Modern title</a></h3></yt-lockup-view-model></main></html>` }));
    await (await browser.page()).goto('https://www.youtube.com/results?search_query=test');
    const snapshot = await browser.snapshot();
    assert.equal(snapshot.elements.length, 140); assert.equal(snapshot.results.length, 181);
    assert.ok(snapshot.results.every(item => !item.text.includes('Channel') && !item.meta));
    assert.equal(snapshot.results.at(-1).text, 'Modern title');
    await browser.activate(snapshot.results[170], snapshot);
    assert.match((await browser.page()).url(), /watch\?v=170$/);
    const page = await browser.page();
    await page.setContent('<main><form><button>Load more</button></form><button>Next</button><a rel="next" href="/checkout">Next page</a></main>');
    assert.equal((await browser.snapshot()).pagination, null, 'forms, generic Next, and consequential pagination URLs are excluded');
    await page.setContent('<ytd-watch-metadata><h1>Currently playing video</h1></ytd-watch-metadata><h3><a id="video-title" href="/watch?v=other">Other video</a></h3>');
    assert.equal((await browser.snapshot()).results[0].text, 'Currently playing video');
  } finally { await browser.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Stop aborts load-more work and ignores late translation/recognition replies', async () => {
  let finishMore, finishTranslation, finishRecognition;
  const snapshot = { pageId: 'page', url: 'https://reader.test', title: 'Page', results: [{ id: '1', text: 'One' }] };
  const spoken = [];
  const browser = { snapshot: async () => snapshot, loadMore: (_snapshot, _scope, signal) => new Promise((resolve, reject) => {
    finishMore = resolve; signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }) };
  const engine = new Engine({ browser, google: { translate: () => new Promise(resolve => { finishTranslation = resolve; }), transcribe: () => new Promise(resolve => { finishRecognition = resolve; }) }, settings: () => ({ guidanceLanguage: 'en-US' }) });
  engine.snapshot = snapshot; engine.reader.load(snapshot); engine.on('narration', value => spoken.push(value));
  const load = engine.control('focus_next'); await until(() => finishMore); engine.stop(); await load;
  assert.equal(engine.more, null); assert.equal(engine.reader.index, 0); assert.equal(spoken.length, 0);
  engine.reader.language = 'si-LK';
  const read = engine.control('repeat'); await until(() => finishTranslation); engine.stop(); finishTranslation('Late translation'); await read;
  assert.equal(spoken.length, 0);
  const record = engine.audio(Buffer.from('audio')); await until(() => finishRecognition); engine.stop(); finishRecognition('next'); await record;
  assert.equal(engine.reader.index, 0); assert.equal(spoken.length, 0);
});

test('a cancelled speech request cannot block or unlock a newer command', async () => {
  const replies = [], spoken = [];
  const engine = new Engine({ browser: {}, google: { translate: () => new Promise(resolve => replies.push(resolve)) }, settings: () => ({ guidanceLanguage: 'en-US' }) });
  engine.reader.load({ pageId: 'one', url: 'https://reader.test', results: [{ id: '1', text: 'One' }] }); engine.reader.language = 'si-LK';
  engine.on('narration', value => spoken.push(value));
  const first = engine.control('repeat'); await until(() => replies.length === 1);
  engine.stop();
  const second = engine.control('repeat'); await until(() => replies.length === 2);
  replies[0]('Old reply'); await first;
  assert.equal(engine.busy, true, 'old completion must not release the newer command');
  engine.stop(); replies[1]('Other old reply'); await second;
  assert.equal(engine.busy, false); assert.equal(spoken.length, 0);
});
