import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import tts from '@google-cloud/text-to-speech';
import { synthesisRequest, SPEECH_MODEL } from '../src/services/google.js';
import { SessionAudioCache, streamSpeech } from '../src/services/speech-stream.js';
import { PcmPlayer } from '../src/renderer/pcm-player.js';

function fixture() {
  const streams = [], cache = new SessionAudioCache();
  const client = { initialize: async () => {}, streamingSynthesize: () => {
    const stream = new EventEmitter(); stream.writes = []; stream.cancelled = 0;
    stream.write = request => stream.writes.push(request);
    stream.end = request => { stream.writes.push(request); stream.halfClosed = true; };
    stream.cancel = () => { stream.cancelled++; stream.emit('error', new Error('cancelled')); };
    streams.push(stream); return stream;
  } };
  const request = synthesisRequest('ආයුබෝවන්.', 'si-LK');
  const run = (options = {}) => streamSpeech({ client, request, scope: ['project', 'credential-file'], cache, onChunk: () => {}, ...options });
  return { streams, cache, request, run };
}

test('streams PCM before completion, half-closes input, and serializes the existing Flash model and prompt', async () => {
  const f = fixture(), heard = []; let complete = false;
  const result = f.run({ onChunk: bytes => heard.push([...bytes]) }).then(value => { complete = true; return value; });
  await setImmediate(); const s = f.streams[0];
  const proto = tts.protos.google.cloud.texttospeech.v1.StreamingSynthesizeRequest;
  const config = proto.decode(proto.encode(proto.fromObject(s.writes[0])).finish()).streamingConfig;
  assert.equal(config.voice.modelName, SPEECH_MODEL); assert.equal(SPEECH_MODEL, 'gemini-2.5-flash-tts');
  assert.equal(config.voice.languageCode, 'si-LK'); assert.equal(config.streamingAudioConfig.audioEncoding, 7);
  assert.equal(config.streamingAudioConfig.sampleRateHertz, 24000);
  assert.equal(proto.decode(proto.encode(proto.fromObject(s.writes[1])).finish()).input.prompt, f.request.input.prompt);
  assert.equal(s.halfClosed, true);
  s.emit('data', { audioContent: Buffer.from([0, 1]) });
  assert.deepEqual(heard, [[0, 1]]); assert.equal(complete, false);
  s.emit('data', { audioContent: Buffer.from([2, 3]) }); s.emit('end');
  assert.deepEqual(await result, { cached: false, bytes: 4, sampleRate: 24000 });
  const replay = []; assert.equal((await f.run({ onChunk: bytes => replay.push(...bytes) })).cached, true);
  assert.deepEqual(replay, [0, 1, 2, 3]); assert.equal(f.streams.length, 1);
});

test('Stop cancels the provider, ignores late chunks, and never caches partial or failed audio', async () => {
  const f = fixture(), abort = new AbortController(), heard = [];
  const result = f.run({ signal: abort.signal, onChunk: bytes => heard.push(bytes) });
  await setImmediate(); const s = f.streams[0]; s.emit('data', { audioContent: Buffer.alloc(2) });
  abort.abort(); await assert.rejects(result, { name: 'AbortError' });
  s.emit('data', { audioContent: Buffer.alloc(2) }); s.emit('end');
  assert.equal(s.cancelled, 1); assert.equal(heard.length, 1); assert.equal(f.cache.bytes, 0);
  const retry = f.run(); await setImmediate(); f.streams[1].emit('error', new Error('failed'));
  await assert.rejects(retry, /failed/); assert.equal(f.cache.bytes, 0);
});

test('empty, truncated, and timed-out streams fail without becoming reusable', async () => {
  for (const bytes of [0, 1]) {
    const f = fixture(); const result = f.run(); await setImmediate();
    f.streams[0].emit('data', { audioContent: Buffer.alloc(bytes) }); f.streams[0].emit('end');
    await assert.rejects(result, /incomplete/); assert.equal(f.cache.bytes, 0);
  }
  const f = fixture(); await assert.rejects(f.run({ timeout: 10 }), /too long/);
  assert.equal(f.streams[0].cancelled, 1);
});

test('cache keys include voice, language, text, and account; clearing invalidates an unfinished fill', async () => {
  const f = fixture();
  const variations = [{}, { request: synthesisRequest('ආයුබෝවන්.', 'si-LK', 'Puck') },
    { request: synthesisRequest('ආයුබෝවන්.', 'en-US') }, { request: synthesisRequest('වෙනත් පෙළ.', 'si-LK') }, { scope: ['other-project'] }];
  for (const options of variations) {
    const result = f.run(options); await setImmediate(); const s = f.streams.at(-1);
    s.emit('data', { audioContent: Buffer.alloc(2) }); s.emit('end'); assert.equal((await result).cached, false);
  }
  assert.equal(f.streams.length, variations.length);
  f.cache.clear(); const result = f.run(); await setImmediate(); f.cache.clear();
  f.streams.at(-1).emit('data', { audioContent: Buffer.alloc(2) }); f.streams.at(-1).emit('end');
  await result; assert.equal(f.cache.bytes, 0);
});

test('session audio has byte and entry limits and evicts the least recently used reading', () => {
  const cache = new SessionAudioCache({ maxBytes: 6, maxEntries: 2 });
  cache.put('a', Buffer.alloc(2)); cache.put('b', Buffer.alloc(2)); cache.get('a'); cache.put('c', Buffer.alloc(2));
  assert.equal(cache.get('b'), undefined); assert.ok(cache.get('a')); assert.ok(cache.get('c'));
  cache.put('d', Buffer.alloc(6)); assert.equal(cache.entries.size, 1); assert.equal(cache.bytes, 6);
  cache.put('too-big', Buffer.alloc(8)); assert.equal(cache.bytes, 6); cache.clear(); assert.equal(cache.bytes, 0);
});

function playerFixture(rate = 1) {
  const buffers = [], sources = [];
  const context = { currentTime: 1, destination: {}, resume: async () => {}, close: async () => { context.closed = true; },
    createBuffer: (_channels, size, sampleRate) => { const values = new Float32Array(size); buffers.push({ values, sampleRate }); return { getChannelData: () => values }; },
    createBufferSource: () => { const source = { playbackRate: {}, connect() {}, disconnect() {}, start(time) { this.startTime = time; }, stop() { this.stopped = true; } }; sources.push(source); return source; }
  };
  return { player: new PcmPlayer({ rate, createContext: () => context }), context, buffers, sources };
}

test('PCM playback starts before stream completion, joins odd-byte chunks and waits for the last audible sample', async () => {
  const { player, buffers, sources, context } = playerFixture(2); await player.start(); let done = false;
  player.done.then(() => { done = true; });
  player.push(Uint8Array.from([0, 128, 255])); player.push(Uint8Array.from([127, 0, 0]));
  assert.deepEqual([...buffers[0].values], [-1]); assert.deepEqual([...buffers[1].values], [32767 / 32768, 0]);
  assert.equal(sources.length, 2); assert.equal(sources[0].playbackRate.value, 2);
  assert.equal(sources[1].startTime, sources[0].startTime + 1 / 24000 / 2);
  sources[0].onended(); await setImmediate(); assert.equal(done, false);
  player.finish(); await setImmediate(); assert.equal(done, false);
  sources[1].onended(); assert.equal(await player.done, true); assert.equal(context.closed, true);
});

test('Stop drops scheduled PCM immediately and stale chunks cannot resume it', async () => {
  const { player, sources } = playerFixture(); player.push(new Uint8Array(48)); player.stop();
  assert.equal(await player.done, false); assert.equal(sources[0].stopped, true);
  player.push(new Uint8Array(48)); player.finish(); assert.equal(sources.length, 1);
});

test('malformed PCM rejects playback instead of advancing the reader', async () => {
  const { player } = playerFixture(); player.push(new Uint8Array(3)); player.finish();
  await assert.rejects(player.done, /incomplete/);
});
