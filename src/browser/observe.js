// This binding reports that a page changed, never a command or page content.
export function observePage() {
  if (window.__svaraObserving) return;
  window.__svaraObserving = true;
  let timer;
  const notify = kind => window.__svaraPageChanged?.(kind).catch(() => {});
  const changed = () => {
    if (!timer) timer = setTimeout(() => { timer = null; notify('content'); }, 350);
  };
  const start = () => {
    new MutationObserver(changed).observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['href', 'title', 'aria-label', 'hidden']
    });
    changed();
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') notify('active'); });
  window.addEventListener('focus', () => notify('active'));
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
}
