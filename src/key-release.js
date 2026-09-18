export function createReleaseWatcher(native, { timeout = 60000 } = {}) {
  const pending = new Map();
  native.initialize(token => {
    const hold = pending.get(token);
    if (!hold) return;
    pending.delete(token); clearTimeout(hold.timer); hold.released();
  });
  const watch = (_key, released, failed) => {
    // Called synchronously inside Electron's shortcut callback, while the
    // native press event identifies exactly which shortcut is being held.
    const token = native.arm();
    const timer = setTimeout(() => {
      pending.delete(token); native.cancel(token); failed();
    }, timeout);
    pending.set(token, { released, timer });
    return () => { pending.delete(token); clearTimeout(timer); native.cancel(token); };
  };
  watch.refresh = () => native.refresh();
  watch.close = () => {
    for (const { timer } of pending.values()) clearTimeout(timer);
    pending.clear(); native.close();
  };
  return watch;
}
