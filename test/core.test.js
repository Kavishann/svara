import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeUrl, searchUrl, validateTranslation, targetNeedsConfirmation, selectDecision, localAction } from '../src/core/policy.js';
import { Reader } from '../src/core/reader.js';
import { Engine } from '../src/core/engine.js';
import { Settings } from '../src/settings.js';
import { recognitionRequest, synthesisRequest } from '../src/services/google.js';
import { buildDecisionRequest } from '../src/services/jev.js';
import { splitForSpeech, speechLocale } from '../src/renderer/audio.js';
import tts from '@google-cloud/text-to-speech';

test('navigation rejects executable schemes and embedded credentials', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hello', 'https://user:password@example.com', 'chrome://settings']) assert.throws(() => safeUrl(url));
  assert.equal(safeUrl('example.com'), 'https://example.com/');
});
test('Sinhala search payload survives translation and URL encoding', () => {
  const original = 'YouTube එකේ අමරදේවගේ සින්දු හොයන්න';
  const command = { english: 'Search YouTube for අමරදේවගේ සින්දු', payload: 'අමරදේවගේ සින්දු', site: 'youtube', url: '', ordinal: 0 };
  assert.deepEqual(validateTranslation(command, original), command);
  assert.equal(new URL(searchUrl('youtube', command.payload)).searchParams.get('search_query'), command.payload);
  assert.throws(() => validateTranslation({ ...command, payload: 'Amaradeva songs' }, original));
});
test('decision confidence cannot bypass confirmations', () => {
  assert.equal(targetNeedsConfirmation({ role: 'button', text: 'Continue' }, 0), true);
  assert.equal(targetNeedsConfirmation({ role: 'link', text: 'Pay', href: 'https://example.com/pay' }, 0), true);
  assert.equal(targetNeedsConfirmation({ role: 'link', text: 'Article', href: 'https://example.com/a' }, 0), false);
  assert.equal(targetNeedsConfirmation({ role: 'link', text: 'Article', href: 'https://example.com/a' }, .4), true);
});
test('unknown model targets never become selectors', () => {
  const snapshot = { elements: [{ id: 's1', text: 'Article', role: 'link' }] };
  assert.equal(selectDecision({ intent: { choice: 'click', confidence: .99 }, target: { choice: 'evil]', confidence: 1 } }, snapshot).kind, 'ambiguous');
  assert.equal(selectDecision({ intent: { choice: 'shell', confidence: 1 } }, snapshot).kind, 'unclear');
  assert.equal(selectDecision({ intent: { choice: 'click', confidence: NaN } }, snapshot).kind, 'unclear');
});
test('reader keeps original text and position after refresh but resets for a new document', () => {
  const reader = new Reader(), snapshot = { pageId: 'a', url: 'https://example.com', results: [{ id: '1', text: 'One' }, { id: '2', text: 'Two' }] };
  reader.load(snapshot); reader.move(1); reader.language = 'si-LK';
  reader.load(snapshot); assert.equal(reader.current().text, 'Two');
  assert.equal(reader.move(1), null); assert.equal(reader.index, 1);
  reader.load({ ...snapshot, pageId: 'b' }); assert.equal(reader.index, 0);
  assert.equal(reader.items[1].text, 'Two');
});
test('Sinhala utterance recording uses Chirp 2 Recognize and preserves binary audio', () => {
  const buffer = Buffer.from('audio');
  const request = recognitionRequest({ projectId: 'sample-project', region: 'asia-southeast1', inputLanguage: 'si-LK' }, buffer);
  assert.equal(request.config.model, 'chirp_2'); assert.deepEqual(request.config.languageCodes, ['si-LK']);
  assert.equal(request.content, buffer); assert.match(request.recognizer, /asia-southeast1/);
});
test('TTS protobuf preserves the requested model and the speaking-only prompt', () => {
  const request = synthesisRequest('ආයුබෝවන්', 'si-LK');
  const proto = tts.protos.google.cloud.texttospeech.v1.SynthesizeSpeechRequest;
  const decoded = proto.decode(proto.encode(proto.fromObject(request)).finish());
  assert.equal(decoded.voice.modelName, 'gemini-2.5-flash-tts');
  assert.equal(decoded.input.text, 'ආයුබෝවන්'); assert.ok(decoded.input.prompt.includes('faithfully'));
});
test('Sinhala TTS chunks honor UTF-8 byte limits without losing words', () => {
  const text = 'සිංහලෙන් කියවන්න. '.repeat(300).trim();
  const chunks = splitForSpeech(text);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every(c => Buffer.byteLength(c) <= 2500));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  assert.equal(speechLocale('en', 'Hello'), 'en-US');
  assert.equal(speechLocale('en-US', 'සිංහල'), 'si-LK');
});
test('Jev request exposes only bounded choices and no form values', () => {
  const request = buildDecisionRequest({ english: 'click first result' }, { url: 'https://example.com', title: 'Page', elements: [{ id: 's1', role: 'link', text: 'One', value: 'secret' }] }, { items: [], index: 0 });
  assert.equal(request.model, 'jev-1.13.0');
  assert.equal(JSON.stringify(request).includes('secret'), false);
  assert.ok(request.questions.intent); assert.ok(request.questions.target); assert.ok(request.questions.risk);
});
test('settings keep secrets out of public state and save only encrypted key material', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'svara-settings-'));
  const crypto = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s.split('').reverse().join('')), decryptString: b => b.toString().split('').reverse().join('') };
  try {
    const settings = new Settings(directory, crypto);
    const { credentialsPath, geminiKey, typesafeKey, ...plain } = settings.data;
    await settings.save({ ...plain, geminiKey: 'test-gemini-secret', typesafeKey: 'test-jev-secret' });
    assert.equal(JSON.stringify(settings.public()).includes('test-gemini-secret'), false);
    const saved = await readFile(path.join(directory, 'settings.json'), 'utf8');
    assert.equal(saved.includes('test-gemini-secret'), false);
    const reloaded = new Settings(directory, crypto); await reloaded.load(); assert.equal(reloaded.data.geminiKey, 'test-gemini-secret');
    await reloaded.save({ ...plain, clearKeys: true }); assert.equal(reloaded.public().hasGeminiKey, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('cancel while translation is in flight prevents every browser action', async () => {
  let resolve, actions = 0;
  const translation = new Promise(r => { resolve = r; });
  const engine = new Engine({ browser: { practice: false, snapshot: async () => { actions++; } }, google: { interpret: () => translation }, jev: {}, settings: () => ({ guidanceLanguage: 'en-US' }) });
  const work = engine.input('open youtube');
  engine.stop(); resolve({ english: 'open youtube', site: 'youtube', payload: '', url: '', ordinal: 0 });
  await work; assert.equal(actions, 0); assert.equal(engine.status, 'ready');
});
test('expired confirmation cannot click and a fresh command clears pending approval', async () => {
  let clicks = 0;
  const engine = new Engine({ browser: { practice: false, activate: async () => clicks++ }, google: {}, jev: {}, settings: () => ({ guidanceLanguage: 'en-US' }) });
  engine.pending = { kind: 'confirm', created: Date.now() - 61000 };
  await engine.input('confirm'); assert.equal(clicks, 0); assert.equal(engine.pending, null);
  engine.pending = { kind: 'confirm', created: Date.now() };
  await engine.input('help'); assert.equal(engine.pending, null); assert.equal(clicks, 0);
  assert.equal(localAction('නවත්වන්න'), 'stop');
});
