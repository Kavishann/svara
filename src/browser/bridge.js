import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const MAX_MESSAGE = 1024 * 1024;
export function packet(value) {
  const json = Buffer.from(JSON.stringify(value));
  if (!json.length || json.length > MAX_MESSAGE) throw new Error('The page is too large to transfer to Svara.');
  const header = Buffer.alloc(4); header.writeUInt32LE(json.length);
  return Buffer.concat([header, json]);
}
export function decoder(receive, failed) {
  let buffered = Buffer.alloc(0), broken = false;
  return chunk => {
    if (broken) return;
    try {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readUInt32LE(0);
        if (!length || length > MAX_MESSAGE) throw new Error('Invalid Chrome message size.');
        if (buffered.length < length + 4) break;
        const message = JSON.parse(buffered.subarray(4, length + 4).toString('utf8'));
        buffered = buffered.subarray(length + 4); receive(message);
      }
    } catch (error) { broken = true; failed(error); }
  };
}

export class ChromeBridge extends EventEmitter {
  constructor({ directory, extensionId }) {
    super(); this.extensionId = extensionId; this.pending = new Map(); this.socket = null;
    this.socketPath = path.join(os.tmpdir(), `sv-${createHash('sha256').update(directory).digest('hex').slice(0, 12)}.sock`);
  }
  get connected() { return Boolean(this.socket && !this.socket.destroyed); }
  async start() {
    const old = await fs.lstat(this.socketPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    if (old) {
      if (!old.isSocket() || old.uid !== process.getuid()) throw new Error('The Chrome connection path is unavailable.');
      const alive = await new Promise(resolve => {
        const probe = net.connect(this.socketPath); probe.once('connect', () => { probe.destroy(); resolve(true); }); probe.once('error', () => resolve(false));
      });
      if (alive) throw new Error('Another Svara app is already using Chrome. Quit that copy first.');
      await fs.unlink(this.socketPath);
    }
    this.server = net.createServer(socket => {
      let accepted = false;
      const timer = setTimeout(() => socket.destroy(), 3000);
      socket.on('error', () => {});
      socket.on('data', decoder(message => {
        if (!accepted) {
          if (message?.type !== 'hello' || message.extensionId !== this.extensionId || this.connected) { socket.destroy(); return; }
          accepted = true; clearTimeout(timer); this.socket = socket;
          socket.write(packet({ type: 'ready' })); this.emit('connection', true); return;
        }
        if (message?.type === 'changed') { this.emit('changed'); return; }
        if (message?.type !== 'result' || typeof message.id !== 'string') return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); pending.cleanup();
        if (message.ok === true) pending.resolve(message.value);
        else pending.reject(new Error(typeof message.error === 'string' ? message.error.slice(0, 240) : 'Chrome could not complete that action.'));
      }, () => socket.destroy()));
      socket.on('close', () => {
        clearTimeout(timer);
        if (this.socket !== socket) return;
        this.socket = null;
        for (const item of this.pending.values()) { item.cleanup(); item.reject(new Error('Chrome disconnected. Open Chrome and reconnect Svara.')); }
        this.pending.clear(); this.emit('connection', false);
      });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socketPath, resolve); });
    await fs.chmod(this.socketPath, 0o600);
  }
  async wait(timeout = 12000) {
    if (this.connected) return;
    await new Promise((resolve, reject) => {
      const changed = ready => { if (ready) { cleanup(); resolve(); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Connect the Svara Chrome extension first. Open Connections → Set up Chrome.')); }, timeout);
      const cleanup = () => { clearTimeout(timer); this.off('connection', changed); };
      this.on('connection', changed);
    });
  }
  request(method, args = {}, signal) {
    signal?.throwIfAborted();
    if (!this.connected) return Promise.reject(new Error('Chrome is not connected. Open Connections → Set up Chrome.'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cancel = error => {
        if (!this.pending.delete(id)) return;
        cleanup(); if (this.connected) this.socket.write(packet({ type: 'cancel', id })); reject(error);
      };
      const abort = () => cancel(new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => cancel(new Error('Chrome took too long. Please try again.')), 12000);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.socket.write(packet({ type: 'request', id, method, args })); } catch (error) { cancel(error); }
    });
  }
  async close() {
    this.socket?.destroy();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    await fs.unlink(this.socketPath).catch(() => {});
  }
}
