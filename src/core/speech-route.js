// Detection runs locally. A page's lang attribute is only a fallback, not proof
// that a video title or mixed-language passage is English.
export function speechRoute(text, hint, identify) {
  const normalized = text.normalize('NFKC');
  const letters = normalized.match(/\p{L}/gu) || [];
  const detected = identify(normalized);
  const local = !letters.length || (letters.every(letter => /^[a-z]$/i.test(letter))
    && detected.language === 'en');
  const language = /[\u0d80-\u0dff]/u.test(text) ? 'si-LK'
    : detected.language && detected.language !== 'und' ? detected.language : hint || 'en-US';
  return { local, language };
}
