// Google streaming output is signed 16-bit little-endian mono PCM at 24 kHz.
// Schedule chunks on one audio clock, without waiting for the full passage.
export class PcmPlayer {
  constructor({ rate = 1, createContext = () => new AudioContext() } = {}) {
    this.context = createContext(); this.rate = Math.max(.6, Math.min(2, Number(rate) || 1));
    this.sources = new Set(); this.nextTime = 0; this.tail = null; this.bytes = 0; this.ended = false; this.settled = false;
    this.done = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.done.catch(() => {});
  }
  async start() { await this.context.resume(); }
  push(chunk) {
    if (this.settled || this.ended) return;
    try {
      if (!(chunk instanceof Uint8Array)) throw new Error('Invalid audio data.');
      this.bytes += chunk.length;
      if (this.bytes > 32 * 1024 * 1024) throw new Error('The audio passage is too long.');
      let bytes = chunk;
      if (this.tail !== null) { bytes = new Uint8Array(chunk.length + 1); bytes[0] = this.tail; bytes.set(chunk, 1); this.tail = null; }
      if (bytes.length % 2) this.tail = bytes[bytes.length - 1];
      const samples = Math.floor(bytes.length / 2);
      if (!samples) return;
      const buffer = this.context.createBuffer(1, samples, 24000), output = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
      for (let i = 0; i < samples; i++) output[i] = view.getInt16(i * 2, true) / 32768;
      const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = this.rate;
      source.connect(this.context.destination); this.sources.add(source);
      source.onended = () => { source.disconnect(); this.sources.delete(source); if (this.ended && !this.sources.size) this.complete(true); };
      const start = Math.max(this.context.currentTime + .035, this.nextTime);
      source.start(start); this.nextTime = start + samples / 24000 / this.rate;
    } catch (error) { this.complete(false, error); }
  }
  finish() {
    if (this.settled) return;
    if (!this.bytes || this.tail !== null) { this.complete(false, new Error('The audio was incomplete. Please try reading again.')); return; }
    this.ended = true; if (!this.sources.size) this.complete(true);
  }
  stop() { this.complete(false); }
  complete(completed, error) {
    if (this.settled) return; this.settled = true;
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.sources.clear(); this.tail = null;
    this.context.close().catch(() => {});
    if (error) this.reject(error); else this.resolve(completed);
  }
}
