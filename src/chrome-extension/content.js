(() => {
  if (globalThis.__svaraContent) return;
  globalThis.__svaraContent = true;
  let paused = [], timer;
  const collect = () => globalThis.svaraCollectPage();
  const changed = () => {
    if (!timer) timer = setTimeout(() => { timer = null; chrome.runtime.sendMessage({ type: 'page-changed' }).catch(() => {}); }, 350);
  };
  new MutationObserver(changed).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'title', 'aria-label', 'hidden'] });
  window.addEventListener('popstate', changed); window.addEventListener('hashchange', changed);
  function verify(target, old) {
    const fresh = collect();
    if (!old || old.pageId !== fresh.pageId || old.url !== fresh.url) throw new Error('The page changed. Refresh the reading list.');
    const found = [...fresh.elements, ...fresh.results, ...fresh.links, ...fresh.headings, fresh.pagination].filter(Boolean).find(item => (item.targetId || item.id) === target?.id);
    if (!found || (found.targetText || found.text) !== (target.targetText || target.text) || found.href !== target.href || found.role !== target.role) throw new Error('That item changed or disappeared. Refresh the reading list.');
    if (!/^s\d+$/.test(found.id)) throw new Error('That item is no longer available.');
    const element = document.querySelector(`[data-svara-id="${found.id}"]`);
    if (!element || element.matches(':disabled,[aria-disabled="true"],[download]')) throw new Error('That item is unavailable.');
    return element;
  }
  async function media(action) {
    const all = [...document.querySelectorAll('video,audio')].filter(item => item.currentSrc || item.src || item.srcObject || item.querySelector('source[src]'));
    if (!all.length) throw new Error('There is no playable video or audio on this page.');
    const playing = all.filter(item => !item.paused && !item.ended);
    if (action === 'pause' || (action === 'media_toggle' && playing.length)) {
      if (playing.length) paused = playing;
      playing.forEach(item => item.pause()); return { media: 'paused' };
    }
    if (playing.length) return { media: 'playing' };
    paused = paused.filter(item => all.includes(item));
    if (!paused.length) paused = [all[0]];
    let timeout;
    try {
      await Promise.race([Promise.all(paused.map(item => item.play())), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Playback took too long. Try Play directly in Chrome.')), 4000); })]);
    } catch (error) { paused.forEach(item => item.pause()); throw error; }
    finally { clearTimeout(timeout); }
    return { media: 'playing' };
  }
  async function perform(message) {
    if (location.hostname === 'accounts.google.com') throw new Error('Complete sign-in directly in Chrome.');
    const { action, target, snapshot, text, scope } = message;
    if (action === 'snapshot') return collect();
    if (action === 'verify') { verify(target, snapshot); return true; }
    if (action === 'activate') {
      const element = verify(target, snapshot);
      if (text !== undefined) {
        if (typeof text !== 'string' || text.length > 1500 || !target.editable || element.matches('input[type="password"],input[autocomplete="one-time-code"],input[autocomplete*="cc-"]') || /password|credit.?card|security.?code|cvv|cvc|otp/i.test(`${element.name} ${element.id} ${element.autocomplete}`)) throw new Error('Enter passwords and verification codes directly in Chrome.');
        element.focus();
        if (element.isContentEditable) element.textContent = text;
        else {
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (!setter) throw new Error('Choose an ordinary text field.');
          setter.call(element, text);
        }
        element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true }));
        if ((element.isContentEditable ? element.textContent : element.value) !== text) throw new Error('The field did not keep the dictated text.');
        return { effect: 'filled' };
      }
      if (element.tagName === 'A') {
        const url = new URL(element.href);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Choose an ordinary web link.');
        if (element.target === '_blank') return { openUrl: url.href, effect: 'activated' };
      }
      element.click(); return { effect: 'activated' };
    }
    if (action === 'load_more') {
      const fresh = collect();
      if (fresh.pageId !== snapshot?.pageId || fresh.url !== snapshot?.url) throw new Error('The page changed. Refresh the reading list.');
      if (snapshot.pagination) {
        if (snapshot.pagination.kind === 'next' && !message.allowNextPage) return { deferred: true };
        verify(snapshot.pagination, snapshot).click();
      } else {
        const last = snapshot[scope]?.at(-1), id = last?.targetId || last?.id;
        if (/^s\d+$/.test(id || '')) document.querySelector(`[data-svara-id="${id}"]`)?.scrollIntoView({ block: 'end' });
        for (const el of [document.scrollingElement, ...document.querySelectorAll('main,[role="main"],ytd-app,#contents')]) if (el && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
      return { started: true };
    }
    if (action === 'scroll_down' || action === 'scroll_up') { window.scrollBy({ top: innerHeight * .8 * (action === 'scroll_down' ? 1 : -1), behavior: 'instant' }); return true; }
    if (['play', 'pause', 'media_toggle'].includes(action)) return media(action);
    throw new Error('That page action is not available.');
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'svara') return;
    perform(message).then(value => reply({ ok: true, value })).catch(error => reply({ ok: false, error: String(error.message).slice(0, 240) }));
    return true;
  });
})();
