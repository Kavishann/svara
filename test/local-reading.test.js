import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { LocalReading } from '../src/local-reading.js';
import { speechRoute } from '../src/core/speech-route.js';
import { Engine } from '../src/core/engine.js';

const fixture = () => {
  const calls = [];
  const reading = new LocalReading({ launch: (...args) => {
    const child = new EventEmitter(); child.stdin = new EventEmitter();
    child.stdin.end = text => { child.text = text; };
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); };
    calls.push({ args, child }); return child;
  } });
  return { reading, calls };
};

test('English reading sends bounded literal text through stdin and waits for completion', async () => {
  const { reading, calls } = fixture();
  let complete = false;
  const promise = reading.play('A quiet morning. --output-file /tmp/example [[slnc 99999]]', 1.5).then(result => { complete = result; });
  assert.deepEqual(calls[0].args, ['/usr/bin/say', ['-v', 'Samantha', '-r', '285'], { stdio: ['pipe', 'ignore', 'ignore'] }]);
  assert.equal(calls[0].child.text, 'A quiet morning. --output-file /tmp/example [ [slnc 99999] ]');
  assert.equal(complete, false);
  calls[0].child.emit('exit', 0); await promise; assert.equal(complete, true);
});

test('Stop resolves local playback without advancing a reading batch; late events cannot affect a new reading', async () => {
  const { reading, calls } = fixture();
  const first = reading.play('First title'); const second = reading.play('Second title');
  assert.equal(await first, false); assert.equal(calls[0].child.killed, true);
  calls[0].child.emit('error', new Error('late'));
  assert.equal(reading.current.process, calls[1].child);
  reading.stop(); assert.equal(await second, false); assert.equal(calls[1].child.killed, true);
});

test('Mac voice failure is reported without silently sending English to a cloud provider', async () => {
  const { reading, calls } = fixture(); const result = reading.play('A title');
  calls[0].child.emit('exit', 1);
  await assert.rejects(result, /Mac voice/);
});

test('Apple detection routes English locally and rejects non-English or mixed scripts despite an English page label', { skip: process.platform !== 'darwin' }, () => {
  const native = createRequire(import.meta.url)('../build/native/language.node');
  const route = (text, hint = 'en-US') => speechRoute(text, hint, native.identify);
  assert.equal(route('A quiet morning in the hill country').local, true);
  assert.equal(route('The music of a rainy afternoon', 'si-LK').local, true);
  assert.equal(route('Best Sinhala Songs Collection').local, true);
  assert.equal(route('YouTube').local, true);
  for (const text of ['සිංහලෙන් කියවන්න', 'Best songs සිංහල', 'Hola como estas amigo', 'Bonjour tout le monde', 'தமிழ் பாடல்கள்', '最新のニュース']) assert.equal(route(text).local, false, text);
  assert.equal(route('Best songs සිංහල').language, 'si-LK');
  assert.throws(() => native.identify('x'.repeat(12001)), /short text/);
});

test('section shortcuts switch the list without reading titles; reading commands still read on request', async () => {
  const snapshot = { pageId: 'page', url: 'https://example.com', title: 'Example' };
  for (const scope of ['results', 'headings', 'article', 'links']) snapshot[scope] = [{ id: scope, text: `${scope} text` }];
  const engine = new Engine({ browser: { snapshot: async () => snapshot }, settings: () => ({ readOnFocus: false, speechEnabled: true }) });
  const spoken = [], focused = [];
  engine.on('narration', value => spoken.push(value)); engine.on('reader-focus', value => focused.push(value));
  for (const [action, scope] of [['show_results', 'results'], ['show_headings', 'headings'], ['show_page', 'article'], ['show_links', 'links']]) {
    await engine.control(action); assert.equal(engine.reader.scope, scope); assert.equal(engine.reader.index, 0); assert.equal(focused.at(-1).raise, true);
  }
  assert.equal(spoken.length, 0);
  await engine.control('repeat'); assert.match(spoken.at(-1).text, /links text/); engine.stop();
});
