import { DEFAULT_SHORTCUTS, normalizeShortcuts, shortcutLabel } from './core/shortcuts.js';

export class ShortcutManager {
  constructor(api, dispatch, watchRelease) {
    this.api = api; this.dispatch = dispatch; this.registered = new Set();
    this.watchRelease = watchRelease; this.held = null;
    this.config = normalizeShortcuts(DEFAULT_SHORTCUTS); this.editing = false; this.updating = false;
  }
  keys(config) { return new Set(config.enabled ? Object.values(config.bindings).filter(Boolean) : []); }
  register(key) {
    const accepted = this.api.register(key, () => {
      if (this.editing || this.updating || !this.config.enabled) return;
      const action = Object.keys(this.config.bindings).find(action => this.config.bindings[action] === key);
      if (action === 'speak') this.startHold(key);
      else if (action) this.dispatch(action);
    });
    if (!accepted) throw new Error(`${shortcutLabel(key)} is unavailable or used by another app. Choose another shortcut.`);
    this.registered.add(key);
  }
  start(config) {
    this.config = normalizeShortcuts(config);
    const errors = [];
    for (const key of this.keys(this.config)) {
      try { this.register(key); } catch (error) { errors.push(error.message); }
    }
    this.watchRelease?.refresh?.();
    return errors.join(' ');
  }
  startHold(key) {
    if (this.held) return; // Ignore the system's repeated key-down callbacks.
    const hold = {}; this.held = hold;
    const finish = action => {
      if (this.held !== hold) return;
      this.held = null; this.dispatch(action);
    };
    try {
      hold.dispose = this.watchRelease(key, () => finish('speak-end'), () => finish('speak-unavailable'));
      if (this.held === hold) this.dispatch('speak-start');
    } catch { finish('speak-unavailable'); }
  }
  cancelHold() {
    if (!this.held) return;
    this.held.dispose?.(); this.held = null; this.dispatch('speak-cancel');
  }
  setEditing(value) {
    this.editing = value; if (value) this.cancelHold();
    if (!this.updating) { this.api.setSuspended(value); this.watchRelease?.refresh?.(); }
  }
  async save(input, persist) {
    if (this.updating) throw new Error('Your shortcuts are still being saved. Please wait.');
    const next = normalizeShortcuts(input), keys = this.keys(next), added = [];
    this.cancelHold();
    this.updating = true;
    // Electron cannot reserve keys while shortcut handling is suspended.
    this.api.setSuspended(false);
    try {
      for (const key of keys) if (!this.registered.has(key)) { this.register(key); added.push(key); }
      const result = await persist(next);
      for (const key of this.registered) if (!keys.has(key)) { this.api.unregister(key); this.registered.delete(key); }
      this.config = next;
      return result;
    } catch (error) {
      for (const key of added) { this.api.unregister(key); this.registered.delete(key); }
      throw error;
    } finally { this.updating = false; this.api.setSuspended(this.editing); this.watchRelease?.refresh?.(); }
  }
}
