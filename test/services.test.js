import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleServices, recognitionProbe } from '../src/services/google.js';
import { JevService } from '../src/services/jev.js';
import { ServiceError, serviceError, withService } from '../src/services/errors.js';
import { Engine } from '../src/core/engine.js';

test('disabled AI Platform errors survive IPC without exposing the provider response', () => {
  const error = serviceError('tts', { code: 7, message: 'PERMISSION_DENIED: Agent Platform API has not been used or is disabled. Enable https://console.example/aiplatform.googleapis.com?key=secret-value' });
  const engine = new Engine({ browser: {}, settings: () => ({}) });
  const shown = engine.friendlyError(error);
  assert.match(shown, /Gemini speech: Enable Agent Platform \/ Vertex AI API/);
  assert.doesNotMatch(shown, /authenticate|TypeSafe|secret-value|console.example/);
});

test('service failures distinguish credentials, permissions, quota, and network', () => {
  assert.match(serviceError('tts', { code: 7 }).message, /aiplatform.endpoints.predict/);
  assert.match(serviceError('stt', { code: 7 }).message, /Speech Client/);
  assert.match(serviceError('gemini', { status: 429 }).message, /quota and billing in Google AI Studio/);
  assert.match(serviceError('gemini', { status: 429, message: 'Your prepayment credits are depleted.' }).message, /prepaid credits are depleted/);
  assert.match(serviceError('jev', { status: 401 }).message, /TypeSafe API key was rejected/);
  assert.match(serviceError('tts', { message: 'Could not load the default credentials' }).message, /credential file is missing or invalid/);
  assert.match(serviceError('tts', { code: 14 }).message, /internet connection/);
  for (const secret of ['AIza-secret', 'AQ.secret', 'Bearer private-token', 'my-private-key']) {
    assert.equal(serviceError('tts', { message: secret }).message.includes(secret), false);
  }
});

test('cancellation and safe setup instructions retain their identity', async () => {
  const cancelled = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(withService('gemini', () => { throw cancelled; }), error => error === cancelled);
  const setup = new ServiceError('Gemini translation: Add your Gemini API key in Connections.');
  assert.equal(serviceError('gemini', setup), setup);
});

test('connection checks call real recognition, synthesis and generation paths independently', async () => {
  const calls = [];
  const google = new GoogleServices(() => ({ projectId: 'test-project', region: 'asia-southeast1', inputLanguage: 'si-LK', voice: 'Kore' }));
  google.client = kind => ({
    stt: { recognize: async request => { calls.push('stt'); assert.equal(request.config.model, 'chirp_2'); assert.equal(request.content.toString('ascii', 0, 4), 'RIFF'); return [{ results: [] }]; } },
    tts: { synthesizeSpeech: async request => { calls.push('tts'); assert.equal(request.voice.languageCode, 'si-LK'); throw { code: 7, message: 'aiplatform.googleapis.com API is disabled' }; } },
    gemini: { models: { generateContent: async request => { calls.push('gemini'); assert.equal(request.model, 'gemini-3.8-flash'); throw { status: 429 }; } } }
  })[kind];
  const results = await google.check();
  assert.deepEqual(calls.sort(), ['gemini', 'stt', 'tts']);
  assert.deepEqual(results.map(r => r.ok), [true, false, false]);
  assert.match(results[1].detail, /Enable Agent Platform/);
  assert.match(results[2].detail, /Usage limit reached/);
  const wav = recognitionProbe();
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.ok(wav.subarray(44).every(byte => byte === 0));
});

test('saved Jev key alone never passes a live connection check', async () => {
  const jev = new JevService(() => ({ typesafeKey: 'test-only' }));
  jev.client = () => ({ systemOne: async () => { throw { status: 401 }; } });
  assert.equal((await jev.check()).ok, false);
  jev.client = () => ({ systemOne: async request => {
    assert.deepEqual(request.state, { connection_test: true });
    return { answers: { ready: { choice: 'ready' } } };
  } });
  assert.equal((await jev.check()).ok, true);
});
