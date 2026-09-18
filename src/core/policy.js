import { z } from 'zod';

export const ACTIONS = {
  navigate: 'Open a named website or a spoken URL.',
  search: 'Search the web or a named website for the original query.',
  click: 'Activate a link, button, or numbered item on the current page.',
  type: 'Fill a named text field with the original dictated text. Do not submit.',
  back: 'Go back in browser history.', forward: 'Go forward in browser history.',
  reload: 'Refresh the current page.', new_tab: 'Create a new browser tab.',
  close_tab: 'Close the current tab.', next_tab: 'Switch to the next tab.', previous_tab: 'Switch to the previous tab.',
  scroll_down: 'Scroll down one screen.', scroll_up: 'Scroll up one screen.',
  read_results: 'Read search results, starting with the first result.',
  read_first_five: 'Read the first five items in the current reading list, one after another, then stop.',
  read_headings: 'Read headings on the current page.', read_page: 'Read the main article or page text.',
  read_links: 'Read links on the current page.', next: 'Read the next item.', previous: 'Read the previous item.',
  repeat: 'Read the current item again.', read_sinhala: 'Translate and read the current item in Sinhala.',
  read_original: 'Read the current item in its original language.',
  where: 'Describe the current page, tab, and reading position.',
  play: 'Play the current video or audio.', pause: 'Pause the current video or audio.',
  help: 'Explain the available browser controls.', stop: 'Stop reading and cancel a pending action.',
  none: 'Not a clear browser command. Ask the user to rephrase.'
};

export const languageSchema = z.object({
  english: z.string().min(1).max(2400),
  payload: z.string().max(1500),
  site: z.enum(['youtube', 'wikipedia', 'google', 'web', 'none']),
  url: z.string().max(2000),
  ordinal: z.number().int().min(0).max(500)
}).strict();

export function validateTranslation(input, original) {
  const parsed = languageSchema.parse(input);
  // The model translates the command; it cannot invent or translate what gets typed.
  if (parsed.payload && !original.normalize('NFC').includes(parsed.payload.normalize('NFC'))) {
    throw new Error('The search or dictated text changed during translation. Please say it again.');
  }
  return parsed;
}

export function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2000) throw new Error('Please give a complete website address.');
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only ordinary http and https web addresses can be opened.');
  }
  return url.href;
}

export function searchUrl(site, query) {
  if (!query?.trim()) throw new Error('Please say what you want to search for.');
  const q = encodeURIComponent(query);
  return site === 'youtube' ? `https://www.youtube.com/results?search_query=${q}`
    : site === 'wikipedia' ? `https://en.wikipedia.org/w/index.php?search=${q}`
    : site === 'google' ? `https://www.google.com/search?q=${q}`
    : `https://duckduckgo.com/?q=${q}`;
}

export function targetNeedsConfirmation(target, risk = 0) {
  // All non-link clicks are confirmed. Model confidence cannot bypass this rule.
  return risk >= 0.3 || target.role !== 'link' || !/^https?:/.test(target.href || '')
    || /delete|remove|send|submit|pay|purchase|checkout|buy|logout|sign.?out|unsubscribe/i.test(`${target.text} ${target.href}`);
}

export function selectDecision(answers, snapshot) {
  const intent = answers.intent;
  if (!intent || !Object.hasOwn(ACTIONS, intent.choice) || intent.choice === 'none'
      || !Number.isFinite(intent.confidence) || intent.confidence < 0.65) {
    return { kind: 'unclear' };
  }
  const action = intent.choice;
  if (!['click', 'type'].includes(action)) return { kind: 'action', action, risk: answers.risk?.noul ?? 1 };
  const target = answers.target;
  const element = snapshot.elements.find(e => e.id === target?.choice);
  if (!element || !Number.isFinite(target?.confidence) || target.confidence < 0.7) {
    const probabilities = target?.probabilities || {};
    const candidates = snapshot.elements.filter(e => Number.isFinite(probabilities[e.id]))
      .sort((a, b) => probabilities[b.id] - probabilities[a.id]).slice(0, 3);
    return { kind: 'ambiguous', action, candidates };
  }
  return { kind: 'action', action, target: element, risk: answers.risk?.noul ?? 1 };
}

const local = new Map(Object.entries({
  'stop': 'stop', 'cancel': 'stop', 'නවත්වන්න': 'stop', 'නවත්තන්න': 'stop',
  'next': 'next', 'ඊළඟ': 'next', 'ඊළඟ එක': 'next', 'previous': 'previous', 'කලින් එක': 'previous',
  'repeat': 'repeat', 'ආයෙත් කියවන්න': 'repeat', 'read in sinhala': 'read_sinhala',
  'සිංහලෙන් කියවන්න': 'read_sinhala', 'read original': 'read_original',
  'where am i': 'where', 'මම කොහෙද': 'where', 'help': 'help', 'උදව්': 'help',
  'go back': 'back', 'back': 'back', 'ආපසු යන්න': 'back', 'forward': 'forward',
  'new tab': 'new_tab', 'open a new tab': 'new_tab', 'අලුත් ටැබ් එකක්': 'new_tab',
  'close tab': 'close_tab', 'close this tab': 'close_tab', 'next tab': 'next_tab', 'previous tab': 'previous_tab',
  'read results': 'read_results', 'ප්‍රතිඵල කියවන්න': 'read_results', 'read headings': 'read_headings',
  'read first five': 'read_first_five', 'read first 5': 'read_first_five', 'read the first five': 'read_first_five',
  'read first five options': 'read_first_five', 'read first five results': 'read_first_five',
  'මුල් පහ කියවන්න': 'read_first_five', 'පළමු පහ කියවන්න': 'read_first_five', 'පළමු ප්‍රතිඵල පහ කියවන්න': 'read_first_five',
  'read page': 'read_page', 'read links': 'read_links', 'scroll down': 'scroll_down', 'scroll up': 'scroll_up',
  'play': 'play', 'pause': 'pause', 'refresh': 'reload'
}));

export function localAction(text) {
  return local.get(String(text).trim().toLowerCase().replace(/[.!?。]+$/u, ''));
}
export function confirmation(text) {
  return /^(confirm|yes|තහවුරු කරන්න|ඔව්)[.!?]?$/iu.test(text.trim());
}

export function spokenNumber(text) {
  const value = String(text).trim().toLowerCase().replace(/[.!?]+$/u, '');
  if (/^[1-9]\d{0,2}$/.test(value)) return Number(value);
  const words = [['one', 'first', 'එක', 'පළවෙනි එක'], ['two', 'second', 'දෙක', 'දෙවෙනි එක'],
    ['three', 'third', 'තුන', 'තුන්වෙනි එක'], ['four', 'fourth', 'හතර'], ['five', 'fifth', 'පහ']];
  const index = words.findIndex(list => list.includes(value));
  return index < 0 ? null : index + 1;
}

export function languageOf(text, hint = '') {
  if (/[\u0D80-\u0DFF]/u.test(text)) return 'si-LK';
  if (hint) return hint;
  return 'en-US';
}

export function chunkText(text, max = 750) {
  const chunks = [];
  let current = '';
  for (const word of String(text).split(/\s+/u)) {
    if (current.length + word.length + 1 > max && current) { chunks.push(current); current = ''; }
    // Also bound unbroken tokens, so no request exceeds the provider's byte limit.
    for (let i = 0; i < word.length; i += max) {
      const part = word.slice(i, i + max);
      if (i) { if (current) chunks.push(current); current = ''; }
      current += (current ? ' ' : '') + part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
