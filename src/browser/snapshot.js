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
  const interactives = [...doc.querySelectorAll('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="searchbox"],[role="textbox"],[contenteditable="true"]')]
    .filter(el => visible(el) && !sensitive(el));
  const elements = interactives.slice(0, 140).map(el => ({
    ...record(el), text: name(el).slice(0, 220),
    role: el.getAttribute('role') || (el.tagName === 'A' ? 'link' : /INPUT|TEXTAREA/.test(el.tagName) || el.isContentEditable ? 'textbox' : el.tagName === 'SELECT' ? 'select' : 'button'),
    href: el.tagName === 'A' ? el.href : '', disabled: el.matches(':disabled,[aria-disabled="true"]'),
    editable: el.matches('input,textarea,[contenteditable="true"],[role="textbox"],[role="searchbox"]'),
    type: el.getAttribute('type') || ''
  })).filter(e => e.text && !e.disabled);
  const links = elements.filter(e => e.role === 'link').map(e => ({ ...e, targetId: e.id }));
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(visible)
    .map(el => ({ ...record(el), level: Number(el.getAttribute('aria-level') || el.tagName.slice(1)) || 2 })).filter(e => e.text).slice(0, 100);
  const results = [];
  const used = new Set();
  const addResult = (anchor, title, meta = '') => {
    if (!anchor || !visible(anchor) || !title || used.has(anchor.href)) return;
    const target = elements.find(e => e.id === id(anchor));
    if (!target) return;
    used.add(anchor.href);
    results.push({ ...target, text: clean(title).slice(0, 300), targetId: target.id, targetText: target.text, meta: clean(meta).slice(0, 200) });
  };
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    for (const card of doc.querySelectorAll('ytd-video-renderer,ytd-rich-item-renderer,ytd-grid-video-renderer')) {
      const anchor = card.querySelector('a#video-title,a#video-title-link');
      const title = anchor ? name(anchor) : '';
      const channel = card.querySelector('ytd-channel-name')?.textContent || '';
      const duration = card.querySelector('ytd-thumbnail-overlay-time-status-renderer')?.textContent || '';
      addResult(anchor, title, `${channel} ${duration}`);
    }
  } else {
    for (const heading of doc.querySelectorAll('main h2,main h3,[role="main"] h2,[role="main"] h3,h3,[data-practice-result]')) {
      const anchor = heading.closest('a[href]') || heading.querySelector('a[href]');
      addResult(anchor, heading.textContent, heading.closest('[data-result]')?.querySelector('[data-meta]')?.textContent || '');
    }
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
    elements, links, headings, results: results.slice(0, 100), article, capturedAt: Date.now() };
}
