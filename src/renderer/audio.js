export function splitForSpeech(text, maxBytes = 2500) {
  const encoder = new TextEncoder();
  const result = []; let current = '';
  for (const char of String(text)) {
    if (encoder.encode(current + char).length > maxBytes) {
      const split = current.lastIndexOf(' ');
      if (split > current.length / 2) { result.push(current.slice(0, split)); current = current.slice(split + 1); }
      else { result.push(current); current = ''; }
    }
    current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function speechLocale(raw, text) {
  if (/[\u0d80-\u0dff]/u.test(text)) return 'si-LK';
  const defaults = { en: 'en-US', si: 'si-LK', ta: 'ta-IN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ja: 'ja-JP', ko: 'ko-KR',
    zh: 'cmn-CN', cmn: 'cmn-CN', hi: 'hi-IN', pt: 'pt-BR', ar: 'ar-EG', it: 'it-IT', ru: 'ru-RU', nl: 'nl-NL', bn: 'bn-BD' };
  try { const locale = new Intl.Locale(raw || 'en'); return defaults[locale.language] && !locale.region ? defaults[locale.language] : locale.toString(); }
  catch { return 'en-US'; }
}
