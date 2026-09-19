export class Reader {
  constructor() { this.reset(); }
  reset() { this.items = []; this.index = -1; this.scope = 'results'; this.snapshot = null; this.language = 'original'; }
  load(snapshot, scope = 'results') {
    const previous = this.current();
    const same = this.snapshot?.pageId === snapshot.pageId && this.snapshot?.url === snapshot.url && this.scope === scope;
    this.snapshot = snapshot;
    this.scope = scope;
    this.items = snapshot[scope] || [];
    this.index = same && previous ? this.items.findIndex(i => i.text === previous.text && (i.id === previous.id || (i.href && i.href === previous.href))) : 0;
    if (this.index < 0 && this.items.length) this.index = 0;
    if (!this.items.length) this.index = -1;
    return this.current();
  }
  current() { return this.items[this.index] || null; }
  move(delta) {
    const next = this.index + delta;
    if (next < 0 || next >= this.items.length) return null;
    this.index = next;
    return this.current();
  }
  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) throw new Error('That item is no longer in the reading list.');
    this.index = index;
    return this.current();
  }
  view() { return { items: this.items, index: this.index, scope: this.scope, language: this.language }; }
}
