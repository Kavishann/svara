import { EventEmitter } from 'node:events';
import { Reader } from './reader.js';
import { localAction, confirmation, spokenNumber, languageOf, targetNeedsConfirmation } from './policy.js';
import { ServiceError } from '../services/errors.js';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, STOP_SHORTCUT, shortcutLabel } from './shortcuts.js';

const messages = {
  ready: ['Ready. Say a command or choose something to read.', 'සූදානම්. විධානයක් කියන්න, නැත්නම් කියවීමට යමක් තෝරන්න.'],
  stopped: ['Stopped.', 'නැවැත්තුවා.'],
  empty: ['No items found in this section. Try headings, links, or page text.', 'මෙම කොටසේ අයිතම හමු වුණේ නැහැ. ශීර්ෂ හෝ සබැඳි තෝරන්න.'],
  end: ['You have reached the end of this reading list.', 'මෙම ලැයිස්තුවේ අවසානයට පැමිණියා.'],
  first: ['You are at the first item.', 'ඔබ පළමු අයිතමයේ සිටිනවා.'],
  unclear: ['I could not identify the command. Please try again, or say help.', 'විධානය පැහැදිලි නැහැ. නැවත කියන්න, නැත්නම් උදව් ඉල්ලන්න.'],
  help: ['Say read results, next, previous, repeat, read in Sinhala, go back, new tab, play, or pause.', 'ප්‍රතිඵල කියවන්න, ඊළඟ එක, කලින් එක, නැවත කියවන්න, සිංහලෙන් කියවන්න, හෝ ආපසු යන්න කියන්න.']
};

export class Engine extends EventEmitter {
  constructor({ browser, google, jev, settings }) {
    super(); Object.assign(this, { browser, google, jev, settings });
    this.reader = new Reader(); this.pending = null; this.status = 'ready'; this.message = 'Your browser, at your pace.';
    this.transcript = ''; this.english = ''; this.history = []; this.epoch = 0; this.busy = false; this.snapshot = null;
  }
  view() {
    return { status: this.status, message: this.message, transcript: this.transcript, english: this.english,
      reader: this.reader.view(), page: this.snapshot ? { title: this.snapshot.title, url: this.snapshot.url } : null,
      practice: this.browser.practice, pending: this.pending ? { label: this.pending.label, kind: this.pending.kind,
        candidates: this.pending.candidates?.map(e => ({ id: e.id, text: e.text })) } : null,
      history: this.history.slice(-12).reverse(), speechEnabled: this.settings().speechEnabled };
  }
  update(status, message) { if (status) this.status = status; if (message !== undefined) this.message = message; this.emit('state', this.view()); }
  say(text, language = this.settings().guidanceLanguage, reading = false) {
    this.message = text; this.emit('state', this.view());
    this.emit('narration', { text, language, epoch: this.epoch, practice: this.browser.practice, reading });
  }
  tell(key) {
    const sinhala = this.settings().guidanceLanguage === 'si-LK';
    let text = messages[key][sinhala ? 1 : 0];
    if (key === 'help') {
      const shortcuts = this.settings().shortcuts || DEFAULT_SHORTCUTS;
      for (const [action, value] of Object.entries(shortcuts.bindings)) if (shortcuts.enabled && value) {
        text += ` ${sinhala ? SHORTCUT_ACTIONS[action].sinhala : SHORTCUT_ACTIONS[action].label}: ${shortcutLabel(value)}.`;
      }
      text += sinhala ? ` කියවීම නවත්වන්න: ${shortcutLabel(STOP_SHORTCUT)}.` : ` Stop reading: ${shortcutLabel(STOP_SHORTCUT)}.`;
    }
    this.say(text);
  }
  stop() {
    this.epoch++; this.abort?.abort(); this.pending = null;
    this.emit('stop'); this.update('ready', messages.stopped[this.settings().guidanceLanguage === 'si-LK' ? 1 : 0]);
  }
  current(epoch) { if (epoch !== this.epoch) throw new DOMException('Cancelled', 'AbortError'); }
  async run(fn) {
    if (this.busy) throw new Error('A command is still finishing. Press Escape to cancel it, then try again.');
    this.busy = true; const epoch = ++this.epoch; this.abort = new AbortController(); this.emit('stop');
    try { await fn(epoch, this.abort.signal); this.current(epoch); if (this.status !== 'confirm') this.update('ready'); }
    catch (error) {
      if (epoch === this.epoch && error.name !== 'AbortError') {
        this.update('error', this.friendlyError(error));
        this.emit('notice', { text: this.message, error: true });
        const language = this.settings().guidanceLanguage;
        const spokenError = language === 'si-LK'
          ? /changed|disappeared|expired/i.test(String(error.message))
            ? 'පිටුව වෙනස් වෙලා. ලැයිස්තුව නැවත ලබාගෙන අයිතමය තෝරන්න.'
            : 'ඉල්ලීම සම්පූර්ණ කරන්න බැරි වුණා. සම්බන්ධතා පරීක්ෂා කර නැවත උත්සාහ කරන්න.'
          : this.message;
        this.emit('narration', { text: spokenError, language, epoch, practice: this.browser.practice, reading: false });
      }
    } finally { this.busy = false; }
    return this.view();
  }
  friendlyError(e) {
    if (e instanceof ServiceError) return e.message;
    const text = String(e.message || 'Something went wrong. Please try again.');
    if (/credential|authentication|permission|unauthorized|api.key|403|401|UNAUTHENTICATED/i.test(text)) return 'A service could not authenticate. Open Connections and check your Google and TypeSafe access.';
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(text)) return 'A service has reached its usage limit. Try again later or check your cloud account.';
    if (/timeout|deadline|ETIMEDOUT/i.test(text)) return 'The request took too long. Your reading position is saved. Please try again.';
    if (/fetch failed|ENOTFOUND|ECONN/i.test(text)) return 'Could not reach the service. Check your internet connection.';
    if (/ZodError|JSON|Unexpected token|structured/i.test(text)) return 'The command translation was unclear. Please say it again.';
    // Never forward raw SDK error bodies, credentials, or request objects to the page.
    return text.length < 260 && !/AIza|AQ\.|Bearer|https:\/\/.*key=|\{/.test(text) ? text : 'The service could not complete the request. Check Connections and try again.';
  }
  async start(practice) {
    this.stop();
    return this.run(async epoch => {
      this.update('working', practice ? 'Opening the practice page…' : 'Opening your browser…');
      const snapshot = await (practice ? this.browser.startPractice() : this.browser.startLive());
      this.current(epoch); this.snapshot = snapshot; this.reader.reset();
      if (practice) { this.reader.load(snapshot, 'results'); this.say('Practice mode. This sample page uses no cloud services. Select an item or try “next”.', 'en-US'); }
      else this.tell('ready');
    });
  }
  async input(text) {
    text = String(text).trim();
    if (!text || text.length > 2400) throw new Error('Please use a short browser command.');
    if (localAction(text) === 'stop') { this.stop(); return this.view(); }
    return this.run(async (epoch, signal) => this.process(text, epoch, signal));
  }
  async audio(buffer) {
    return this.run(async (epoch, signal) => {
      if (this.browser.practice) throw new Error('Practice mode uses typed commands. Switch to live browsing and connect Google to use speech.');
      this.update('listening', 'Recognizing your command…');
      const text = await this.google.transcribe(buffer); this.current(epoch);
      if (localAction(text) === 'stop') { this.stop(); return; }
      await this.process(text, epoch, signal);
    });
  }
  async process(text, epoch, signal) {
    this.transcript = text; this.english = '';
    this.history.push({ text, time: Date.now() });
    if (confirmation(text)) { await this.confirmPending(epoch); return; }
    const direct = localAction(text);
    if (this.pending?.kind === 'ambiguous' && spokenNumber(text) !== null) {
      await this.chooseCandidate(spokenNumber(text) - 1, epoch); return;
    }
    this.pending = null;
    if (direct) { await this.perform(direct, {}, epoch, signal); return; }
    if (this.browser.practice) {
      const match = text.match(/^(?:open|read|play)(?: the)? (first|second|third|fourth|fifth|\d+)(?: one| result)?$/i);
      if (match) {
        const words = ['first', 'second', 'third', 'fourth', 'fifth'];
        const index = words.includes(match[1].toLowerCase()) ? words.indexOf(match[1].toLowerCase()) : Number(match[1]) - 1;
        this.reader.select(index); this.update(); await this.read(epoch, signal); return;
      }
      throw new Error('Practice supports next, previous, repeat, read results, read headings, read page, and tabs. Connect services for other commands.');
    }
    this.update('working', 'Translating your command…');
    const command = await this.google.interpret(text, signal); this.current(epoch); this.english = command.english;
    this.snapshot = await this.browser.snapshot(); this.current(epoch);
    this.update('working', 'Choosing the browser action…');
    const decision = await this.jev.decide(command, this.snapshot, this.reader.view(), signal); this.current(epoch);
    if (decision.kind === 'unclear') { this.tell('unclear'); return; }
    if (decision.kind === 'ambiguous') {
      if (!decision.candidates.length) { this.tell('unclear'); return; }
      this.pending = { ...decision, kind: 'ambiguous', command, snapshot: this.snapshot, created: Date.now(),
        label: 'Choose the intended item: ' + decision.candidates.map((e, i) => `${i + 1}. ${e.text}`).join('. ') };
      this.update('confirm'); await this.guidance(this.pending.label, epoch, signal); return;
    }
    if (['click', 'type'].includes(decision.action)) {
      await this.prepareTarget(decision.target, decision.action, command, decision.risk, this.snapshot, epoch, signal); return;
    }
    await this.perform(decision.action, command, epoch, signal);
  }
  async guidance(english, epoch, signal) {
    if (this.settings().guidanceLanguage === 'si-LK' && !this.browser.practice) {
      try { const translated = await this.google.translate(english, 'Sinhala', signal); this.current(epoch); this.say(translated, 'si-LK'); return; }
      catch (e) { this.current(epoch); }
    }
    this.say(english, 'en-US');
  }
  async prepareTarget(target, action, command, risk, snapshot, epoch, signal) {
    if (!target) { this.tell('unclear'); return; }
    if (action === 'type' && !command.payload) throw new Error('Please say the exact text to put in the field.');
    await this.browser.verifyTarget(target, snapshot); this.current(epoch);
    if (action === 'click' && targetNeedsConfirmation(target, risk)) {
      this.pending = { kind: 'confirm', action, target, command, snapshot, created: Date.now(),
        label: `Activate “${target.text}” on ${new URL(snapshot.url).hostname || 'this page'}? Say confirm or cancel.` };
      this.update('confirm'); await this.guidance(this.pending.label, epoch, signal); return;
    }
    await this.browser.activate(target, snapshot, action === 'type' ? command.payload : undefined); this.current(epoch);
    await this.afterAction(action, epoch, signal);
  }
  async confirmPending(epoch) {
    const pending = this.pending;
    if (!pending || pending.kind !== 'confirm' || Date.now() - pending.created > 60000) {
      this.pending = null; throw new Error('There is no current action to confirm. Please give the command again.');
    }
    this.pending = null;
    await this.browser.activate(pending.target, pending.snapshot); this.current(epoch);
    await this.afterAction(pending.action, epoch, this.abort.signal);
  }
  async chooseCandidate(index, epoch) {
    const p = this.pending;
    if (!p || p.kind !== 'ambiguous' || Date.now() - p.created > 60000 || !p.candidates[index]) throw new Error('That choice expired. Please repeat the command.');
    this.pending = null;
    await this.prepareTarget(p.candidates[index], p.action, p.command, 1, p.snapshot, epoch, this.abort.signal);
  }
  async afterAction(action, epoch, signal) {
    this.snapshot = await this.browser.snapshot(); this.current(epoch);
    if (['navigate', 'search', 'click', 'back', 'forward', 'reload', 'next_tab', 'previous_tab', 'new_tab', 'close_tab'].includes(action)) {
      this.reader.load(this.snapshot, this.snapshot.results.length ? 'results' : 'headings');
    }
    const label = action === 'type' ? 'The text is in the field. It has not been submitted.'
      : action === 'click' ? `Activated the item. Current page: ${this.snapshot.title}.`
      : `${action.replaceAll('_', ' ')}. ${this.snapshot.title}. ${this.reader.items.length} items in the reading list.`;
    await this.guidance(label, epoch, signal);
  }
  async read(epoch, signal) {
    const item = this.reader.current();
    if (!item) { this.tell('empty'); return; }
    let text = item.text + (item.meta ? `. ${item.meta}` : '');
    let language = languageOf(text, item.language);
    if (this.reader.language === 'si-LK' && language !== 'si-LK') {
      if (this.browser.practice) throw new Error('Sinhala translation needs Gemini. Switch to live mode and add your connections.');
      this.update('working', 'Translating this item into Sinhala…');
      text = await this.google.translate(text, 'Sinhala', signal); this.current(epoch); language = 'si-LK';
    }
    this.say(`${this.reader.index + 1}. ${text}`, language, true);
  }
  async perform(action, command, epoch, signal) {
    const scopes = { read_results: 'results', read_headings: 'headings', read_page: 'article', read_links: 'links' };
    if (scopes[action]) {
      this.update('working', 'Collecting page content…');
      this.snapshot = await this.browser.snapshot(); this.current(epoch);
      this.reader.load(this.snapshot, scopes[action]); this.reader.index = this.reader.items.length ? 0 : -1;
      await this.read(epoch, signal);
    } else if (['next', 'previous'].includes(action)) {
      if (!this.reader.move(action === 'next' ? 1 : -1)) this.tell(action === 'next' ? 'end' : 'first');
      else await this.read(epoch, signal);
    } else if (action === 'repeat') await this.read(epoch, signal);
    else if (action === 'read_sinhala' || action === 'read_original') {
      this.reader.language = action === 'read_sinhala' ? 'si-LK' : 'original'; await this.read(epoch, signal);
    } else if (action === 'where') {
      this.snapshot = await this.browser.snapshot(); this.current(epoch);
      const tabs = await this.browser.tabs(); this.current(epoch);
      await this.guidance(`You are on ${this.snapshot.title}. Tab ${tabs.findIndex(t => t.active) + 1} of ${tabs.length}. Reading item ${Math.max(0, this.reader.index + 1)} of ${this.reader.items.length}.`, epoch, signal);
    } else if (action === 'help') this.tell('help');
    else if (action === 'stop') this.stop();
    else {
      this.update('working', 'Updating your browser…');
      await this.browser.execute(action, command); this.current(epoch); await this.afterAction(action, epoch, signal);
    }
  }
  async control(action, index) {
    if (action === 'stop') { this.stop(); return this.view(); }
    return this.run(async (epoch, signal) => {
      if (action === 'select') { this.reader.select(index); await this.read(epoch, signal); }
      else if (action === 'open_item' || action === 'open_current') {
        if (this.pending) throw new Error('Confirm or cancel the pending choice before opening a reading item.');
        if (!this.reader.current() && action === 'open_current') { this.tell('empty'); return; }
        const item = this.reader.select(action === 'open_current' ? this.reader.index : index);
        if (!item.targetId) throw new Error('This is a reading passage, not a link.');
        const target = { ...item, id: item.targetId };
        await this.prepareTarget(target, 'click', {}, 0, this.reader.snapshot, epoch, signal);
      } else if (action === 'confirm') await this.confirmPending(epoch);
      else if (action === 'choose') await this.chooseCandidate(index, epoch);
      else if (action === 'switch_tab') {
        await this.browser.switchTab(index); this.current(epoch); await this.afterAction('next_tab', epoch, signal);
      } else await this.perform(action, {}, epoch, signal);
    });
  }
}
