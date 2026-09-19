import { createHash } from 'node:crypto';
import { ServiceError } from './errors.js';

export const SPEECH_SAMPLE_RATE = 24000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const cancelled = () => new DOMException('Reading was cancelled.', 'AbortError');

// Completed audio only, kept in memory. Neither text nor audio is written to disk.
export class SessionAudioCache {
  constructor({ maxBytes = 24 * 1024 * 1024, maxEntries = 120 } = {}) {
    Object.assign(this, { maxBytes, maxEntries }); this.clear();
  }
  clear() { this.entries = new Map(); this.bytes = 0; this.generation = (this.generation || 0) + 1; }
  get(key) {
    const audio = this.entries.get(key);
    if (audio) { this.entries.delete(key); this.entries.set(key, audio); }
    return audio;
  }
  put(key, audio) {
    if (audio.length > this.maxBytes) return;
    if (this.entries.has(key)) { this.bytes -= this.entries.get(key).length; this.entries.delete(key); }
    while (this.entries.size && (this.bytes + audio.length > this.maxBytes || this.entries.size >= this.maxEntries)) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).length; this.entries.delete(oldest);
    }
    this.entries.set(key, audio); this.bytes += audio.length;
  }
}

export async function streamSpeech({ client, request, scope, cache, signal, onChunk, timeout = 30000 }) {
  signal?.throwIfAborted();
  const key = createHash('sha256').update(JSON.stringify([scope, request])).digest('hex');
  const cached = cache.get(key);
  if (cached) {
    for (let offset = 0; offset < cached.length; offset += 65536) {
      signal?.throwIfAborted(); onChunk(cached.subarray(offset, offset + 65536));
    }
    return { cached: true, bytes: cached.length, sampleRate: SPEECH_SAMPLE_RATE };
  }
  const generation = cache.generation;
  // Initialize explicitly so authentication failures reject this request rather
  // than escaping the SDK's streaming initializer as an unhandled rejection.
  await client.initialize(); signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const stream = client.streamingSynthesize({ timeout });
    let settled = false, bytes = 0; const chunks = [];
    const finish = error => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) { stream.cancel(); reject(error); return; }
      if (generation === cache.generation) cache.put(key, Buffer.concat(chunks, bytes));
      resolve({ cached: false, bytes, sampleRate: SPEECH_SAMPLE_RATE });
    };
    const abort = () => finish(cancelled());
    const timer = setTimeout(() => finish(new ServiceError('Gemini speech: The request took too long. Please try reading again.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('error', error => finish(error));
    stream.on('data', response => {
      if (settled) return;
      try {
        signal?.throwIfAborted();
        const audio = Buffer.from(response.audioContent || []);
        if (!audio.length) return;
        bytes += audio.length;
        if (bytes > MAX_AUDIO_BYTES) throw new ServiceError('Gemini speech: The audio was too long. Try a shorter passage.');
        chunks.push(audio);
        for (let offset = 0; offset < audio.length; offset += 65536) onChunk(audio.subarray(offset, offset + 65536));
      } catch (error) { finish(error); }
    });
    stream.on('end', () => finish(!bytes || bytes % 2 ? new ServiceError('Gemini speech: The audio was incomplete. Please try reading again.') : null));
    stream.on('close', () => { if (!settled) finish(new ServiceError('Gemini speech: The audio connection closed early. Please try reading again.')); });
    try {
      signal?.throwIfAborted();
      stream.write({ streamingConfig: { voice: request.voice,
        streamingAudioConfig: { audioEncoding: 'PCM', sampleRateHertz: SPEECH_SAMPLE_RATE } } });
      // Gemini starts generation after the input half-close, so send the complete
      // bounded passage and end input immediately; output remains open to stream.
      stream.end({ input: request.input });
    } catch (error) { finish(error); }
  });
}
