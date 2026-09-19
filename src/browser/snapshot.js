// Runs in the controlled page, with no access to Electron or credentials.
export function collectPage() {
  const doc = document;
  if (!window.__svaraDocument) window.__svaraDocument = { id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join('-'), next: 1, nodes: new WeakMap() };
  const registry = window.__svaraDocument;
  const clean = s => String(s || '').replace(/\s+/gu, ' ').trim();
  const visible = el => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };
  const sensitive = el => el.matches('input[type="password"],input[autocomplete*="cc-"],input[autocomplete="one-time-code"]')
    || /password|credit.?card|security.?code|cvv|cvc|otp/i.test(`${el.getAttribute('name')} ${el.getAttribute('id')} ${el.getAttribute('autocomplete')}`);
  const id = el => {
    if (!registry.nodes.has(el)) registry.nodes.set(el, `s${registry.next++}`);
    const value = registry.nodes.get(el); el.setAttribute('data-svara-id', value); return value;
  };
  const name = el => {
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(key => doc.getElementById(key)?.textContent || '').join(' ');
    return clean(el.getAttribute('aria-label') || by || [...(el.labels || [])].map(l => l.textContent).join(' ')
      || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.querySelector('img[alt]')?.alt || '');
  };
  const lang = el => el.closest('[lang]')?.getAttribute('lang') || doc.documentElement.lang || 'en-US';
  const record = (el, text) => ({ id: id(el), text: clean(text ?? name(el)).slice(0, 1400), language: lang(el) });
  const target = el => ({ ...record(el), text: name(el).slice(0, 220),
    role: el.getAttribute('role') || (el.tagName === 'A' ? 'link' : /INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable ? 'textbox' : el.tagName === 'SELECT' ? 'select' : 'button'),
    href: el.tagName === 'A' ? el.href : '', disabled: el.matches(':disabled,[aria-disabled="true"]'),
    editable: el.matches('input,textarea,[contenteditable="true"],[role="textbox"],[role="searchbox"]'), type: el.getAttribute('type') || '' });
  const interactives = [...doc.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="searchbox"],[role="textbox"],[contenteditable="true"]')]
    .filter(el => visible(el) && !sensitive(el));
  const elements = interactives.slice(0, 140).map(target).filter(e => e.text && !e.disabled);
  const links = interactives.filter(el => el.matches('a[href],[role="link"]')).slice(0, 500)
    .map(el => ({ ...target(el), targetId: id(el) })).filter(e => e.text && !e.disabled);
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible).slice(0, 300)
    .map(el => {
      const anchor = el.closest('a[href]') || el.querySelector('a[href]'), heading = record(el, el.textContent);
      return { ...heading, ...(anchor ? { ...target(anchor), text: heading.text, targetId: id(anchor), targetText: name(anchor).slice(0, 220) } : {}),
        level: Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || 2 };
    }).filter(e => e.text);
  const results = [], used = new Set();
  const addResult = (anchor, title) => {
    if (!anchor || !visible(anchor) || !clean(title) || used.has(anchor.href) || results.length >= 500) return;
    const item = target(anchor);
    if (item.disabled || !/^https?:|^file:/.test(item.href)) return;
    used.add(anchor.href);
    results.push({ ...item, text: clean(title).slice(0, 500), targetId: item.id, targetText: item.text, meta: '' });
  };
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    // YouTube aria-labels often contain channel, duration and view counts.
    // Read only the visible title, including the newer lockup layout.
    const currentVideo = doc.querySelector('ytd-watch-metadata h1, ytd-watch-flexy h1.title');
    if (location.pathname === '/watch' && currentVideo && visible(currentVideo)) results.push(record(currentVideo, currentVideo.textContent));
    for (const anchor of doc.querySelectorAll('a#video-title,a#video-title-link,yt-lockup-view-model h3 a[href],.yt-lockup-metadata-view-model__title a[href],a.yt-lockup-metadata-view-model__title')) {
      if (!/\/(watch|shorts|live)(?:[/?]|$)/.test(new URL(anchor.href, location.href).pathname + new URL(anchor.href, location.href).search)) continue;
      addResult(anchor, anchor.getAttribute('title') || anchor.textContent);
    }
  } else {
    for (const heading of doc.querySelectorAll('main h1,main h2,main h3,[role="main"] h2,[role="main"] h3,h3,[data-practice-result]')) {
      addResult(heading.closest('a[href]') || heading.querySelector('a[href]'), heading.textContent);
    }
  }
  const pagers = interactives.filter(el => !el.closest('form') && !el.form && !el.matches(':disabled,[aria-disabled="true"],[download]'));
  let pagination = null;
  for (const el of pagers) {
    const label = clean(el.getAttribute('aria-label') || el.textContent).toLowerCase();
    const more = /^(load more|show more|more results|show more results|load more results|more videos|show more videos)$/.test(label);
    const navigation = el.closest('nav[aria-label*="pagin" i],[role="navigation"][aria-label*="pagin" i],.pagination,[class*="pagination"],#pnnext');
    const next = el.matches('a[rel~="next"]') || (navigation && /^(next|next page|older|older posts|›|»|→)$/.test(label));
    if (!more && !next) continue;
    const item = target(el);
    if (item.href) {
      const url = new URL(item.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || /delete|logout|checkout|purchase|pay|submit/i.test(url.pathname)) continue;
    }
    if (item.role !== 'link' && item.role !== 'button') continue;
    pagination = { ...item, kind: more ? 'more' : 'next' }; break;
  }
  const main = doc.querySelector('article,main,[role="main"]') || doc.body;
  const article = [...main.querySelectorAll('h1,h2,h3,p,li,blockquote')]
    .filter(el => visible(el) && !el.closest('nav,header,footer,aside,form') && !el.querySelector('p,li'))
    .flatMap(el => {
      const text = clean(el.innerText), chunks = [];
      let remaining = text, part = 0;
      while (remaining && chunks.length < 80) {
        let length = remaining.length > 1200 ? remaining.lastIndexOf(' ', 1200) : remaining.length;
        if (length <= 0) length = Math.min(1200, remaining.length);
        chunks.push({ ...record(el, remaining.slice(0, length)), id: `${id(el)}-p${part++}` });
        remaining = remaining.slice(length).trim();
      }
      return chunks;
    }).filter(e => e.text.length > 15).slice(0, 160);
  return { pageId: registry.id, url: location.href, title: doc.title || 'Untitled page', language: doc.documentElement.lang || 'en-US',
    elements, links, headings, results, article, pagination, capturedAt: Date.now() };
}
