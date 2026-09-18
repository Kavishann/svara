import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.js';
import { localAction } from '../src/core/policy.js';

function setup(count = 8) {
  const snapshot = { pageId: 'page', url: 'https://example.com', results: Array.from({ length: count }, (_, i) => ({ id: `${i}`, text: `Item ${i + 1}`, language: 'en' })) };
  const translated = [], spoken = [];
  const browser = { practice: false, snapshot: async () => snapshot, isCurrent: async () => true };
  const engine = new Engine({ browser, google: { translate: async text => { translated.push(text); return 'සිංහල අයිතමය'; } },
    settings: () => ({ guidanceLanguage: 'en-US' }) });
  engine.reader.load(snapshot); engine.on('narration', request => spoken.push(request));
  return { engine, spoken, translated, browser, snapshot };
}
async function finish(engine, request) { await engine.continueReading(request.epoch, request.batch.index); }

test('first five starts at one, reads sequentially, and cannot continue to six', async () => {
  const { engine, spoken, translated } = setup(); engine.reader.select(6);
  await engine.control('read_first_five');
  for (let i = 0; i < 5; i++) {
    assert.equal(engine.reader.index, i); assert.equal(spoken[i].text, `${i + 1}. Item ${i + 1}`);
    await finish(engine, spoken[i]);
  }
  assert.equal(spoken.length, 5); assert.equal(engine.reader.index, 4); assert.equal(engine.batch, null);
  await finish(engine, spoken[4]); assert.equal(spoken.length, 5); assert.deepEqual(translated, []);
});
test('short and empty lists are bounded without inventing options', async () => {
  const { engine, spoken } = setup(2); await engine.control('read_first_five');
  await finish(engine, spoken[0]); await finish(engine, spoken[1]);
  assert.equal(spoken.length, 2); assert.equal(engine.reader.index, 1);
  const empty = setup(0); await empty.engine.control('read_first_five');
  assert.match(empty.spoken[0].text, /No items/); assert.equal(empty.spoken[0].batch, null);
});
test('Stop and manual selection invalidate pending or duplicate playback acknowledgements', async () => {
  const { engine, spoken } = setup(); await engine.control('read_first_five');
  const first = spoken[0]; await finish(engine, first); await finish(engine, first);
  assert.equal(engine.reader.index, 1); assert.equal(spoken.length, 2);
  engine.stop(); await finish(engine, spoken[1]); assert.equal(spoken.length, 2);
  await engine.control('read_first_five'); const old = spoken.at(-1);
  await engine.control('select', 7); await finish(engine, old); assert.equal(engine.reader.index, 7);
});
test('requested Sinhala translation applies to all five without changing original text', async () => {
  const { engine, spoken, translated } = setup(); engine.reader.language = 'si-LK';
  await engine.input('මුල් පහ කියවන්න');
  for (let i = 0; i < 5; i++) await finish(engine, spoken[i]);
  assert.equal(translated.length, 5); assert.ok(spoken.every(r => r.language === 'si-LK'));
  assert.equal(engine.reader.items[0].text, 'Item 1');
  assert.equal(localAction('read first 5'), 'read_first_five');
});
test('navigation and cancellation during translation cannot continue old reading', async () => {
  const { engine, spoken, browser } = setup(); await engine.control('read_first_five');
  browser.isCurrent = async () => false;
  await finish(engine, spoken[0]); assert.equal(engine.reader.index, 0); assert.match(engine.message, /page changed/);
  let translate; engine.google.translate = () => new Promise(resolve => { translate = resolve; });
  engine.reader.language = 'si-LK';
  const run = engine.control('read_first_five');
  await new Promise(resolve => setImmediate(resolve));
  engine.stop(); const before = spoken.length; translate('Late translation'); await run;
  assert.equal(spoken.length, before);
});
