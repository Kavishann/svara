import { DEFAULT_SHORTCUTS, SINGLE_KEY_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_KEYS, MODIFIERS, normalizeShortcuts, shortcutLabel } from '../core/shortcuts.js';

export function createShortcutEditor({ api, saved, activate, notice }) {
  const form = document.querySelector('#shortcuts-form'), rows = document.querySelector('#shortcut-rows');
  const controls = {};
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  for (const [action, names] of Object.entries(SHORTCUT_ACTIONS)) {
    const row = document.createElement('div'); row.className = 'shortcut-row';
    const description = document.createElement('div'), title = document.createElement('strong'), sinhala = document.createElement('span');
    title.textContent = names.label; sinhala.textContent = names.sinhala; sinhala.lang = 'si'; description.append(title, sinhala);
    const field = (suffix, labelText) => {
      const wrapper = document.createElement('div'), label = document.createElement('label'), select = document.createElement('select');
      select.id = `shortcut-${action}-${suffix}`; label.htmlFor = select.id; label.textContent = labelText;
      select.setAttribute('aria-label', `${names.label}: ${labelText}`); wrapper.append(label, select); row.append(wrapper); return select;
    };
    row.append(description);
    const key = field('key', 'Key'), modifiers = field('modifiers', 'Extra keys');
    key.append(option('', 'Not assigned'), ...SHORTCUT_KEYS.map(value => option(value, shortcutLabel(value))));
    for (let mask = 0; mask < 16; mask++) {
      const value = MODIFIERS.filter((_, index) => mask & (1 << index)).join('+');
      modifiers.append(option(value, value ? shortcutLabel(value) : 'None — one key'));
    }
    key.onchange = () => { modifiers.disabled = !key.value; };
    controls[action] = { key, modifiers }; rows.append(row);
  }
  const status = document.querySelector('#shortcut-status');
  form.addEventListener('change', () => {
    status.textContent = 'Your choices are ready. Save and use shortcuts to apply them.';
    status.classList.remove('failed');
  });
  const fill = input => {
    const config = normalizeShortcuts(input || DEFAULT_SHORTCUTS);
    document.querySelector('#shortcuts-enabled').checked = config.enabled;
    for (const [action, value] of Object.entries(config.bindings)) {
      const parts = value.split('+'); controls[action].key.value = parts.pop();
      controls[action].modifiers.value = parts.join('+'); controls[action].modifiers.disabled = !value;
    }
    status.textContent = 'Shortcuts are paused while this page is open. Save and use them, or return Home to resume your saved keys.';
    status.classList.remove('failed');
  };
  document.querySelector('#single-key-preset').onclick = () => {
    fill(SINGLE_KEY_SHORTCUTS); status.textContent = 'Ready to save: F2 results, F3 headings, F4 page text, F5 links, F6 previous, F7 next, F8 speak, F9 open, F10 read, F11 first five, F12 stop. Media pause/resume, Sinhala and original-language reading can also be assigned below.';
  };
  document.querySelector('#reset-shortcuts').onclick = () => { fill(DEFAULT_SHORTCUTS); status.textContent = 'Original shortcuts selected. Save to apply them.'; };
  form.onsubmit = async event => {
    event.preventDefault(); const button = document.querySelector('#save-shortcuts'); button.disabled = true;
    try {
      const bindings = Object.fromEntries(Object.entries(controls).map(([action, { key, modifiers }]) =>
        [action, key.value ? [modifiers.value, key.value].filter(Boolean).join('+') : '']));
      const config = normalizeShortcuts({ enabled: document.querySelector('#shortcuts-enabled').checked, bindings });
      const result = await api.saveShortcuts(config); saved(result); await activate();
      notice(config.enabled ? 'Your shortcuts are saved and ready to use.' : 'Custom shortcuts are switched off. The on-screen controls still work.', false);
    } catch (error) { status.textContent = error.message; status.classList.add('failed'); status.focus(); }
    finally { button.disabled = false; }
  };
  return { fill };
}
