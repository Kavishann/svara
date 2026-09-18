export const SHORTCUT_ACTIONS = {
  speak: { label: 'Start / finish speaking', sinhala: 'කතා කරන්න / අවසන් කරන්න' },
  previous: { label: 'Read previous item', sinhala: 'කලින් එක කියවන්න' },
  next: { label: 'Read next item', sinhala: 'ඊළඟ එක කියවන්න' },
  open: { label: 'Open current item', sinhala: 'තෝරාගත් අයිතමය විවෘත කරන්න' }
};
export const STOP_SHORTCUT = 'Control+Alt+Escape';
export const DEFAULT_SHORTCUTS = { enabled: true, bindings: { speak: 'Control+Alt+Space', previous: '', next: '', open: '' } };
export const SINGLE_KEY_SHORTCUTS = { enabled: true, bindings: { speak: 'F8', previous: 'F6', next: 'F7', open: 'F9' } };
export const SHORTCUT_KEYS = ['Space', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'];
export const MODIFIERS = ['Control', 'Alt', 'Shift', 'Command'];
const keyNames = { Alt: 'Option', Up: 'Up arrow', Down: 'Down arrow', Left: 'Left arrow', Right: 'Right arrow', PageUp: 'Page Up', PageDown: 'Page Down' };

export function shortcutLabel(value) { return value ? value.split('+').map(part => keyNames[part] || part).join(' + ') : 'Not assigned'; }

export function normalizeShortcuts(input) {
  if (!input || typeof input.enabled !== 'boolean' || !input.bindings || typeof input.bindings !== 'object'
    || Object.keys(input).some(k => !['enabled', 'bindings'].includes(k))
    || Object.keys(input.bindings).some(k => !Object.hasOwn(SHORTCUT_ACTIONS, k))) throw new Error('Choose a key for each shortcut, or choose Not assigned.');
  const bindings = {}, used = new Set();
  for (const [action, { label }] of Object.entries(SHORTCUT_ACTIONS)) {
    const value = input.bindings[action];
    if (typeof value !== 'string' || value.length > 80) throw new Error(`Choose a valid key for ${label}.`);
    if (!value) { bindings[action] = ''; continue; }
    const parts = value.split('+'), key = parts.pop();
    if (!SHORTCUT_KEYS.includes(key) || parts.some(part => !MODIFIERS.includes(part)) || new Set(parts).size !== parts.length) {
      throw new Error(`Choose a letter, number, arrow, Space, Enter, or function key for ${label}.`);
    }
    const normalized = [...MODIFIERS.filter(part => parts.includes(part)), key].join('+');
    // Preserve common app editing and exit commands as escape routes for single-key users.
    if (['Command+Q', 'Command+W', 'Command+H', 'Command+C', 'Command+V', 'Command+X', 'Command+A', 'Command+Z', 'Command+K'].includes(normalized)) {
      throw new Error(`${shortcutLabel(normalized)} is reserved for normal Mac controls. Choose another key.`);
    }
    if (used.has(normalized)) throw new Error(`${shortcutLabel(normalized)} is assigned twice. Choose a different key for each action.`);
    used.add(normalized); bindings[action] = normalized;
  }
  return { enabled: input.enabled, bindings };
}
