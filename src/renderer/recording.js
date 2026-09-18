// Each hold owns its stream and chunks, including while permission is pending.
export class HoldRecorder {
  constructor({ prepare, getStream, createRecorder, onState, submit, onError, maxDuration = 45000 }) {
    Object.assign(this, { prepare, getStream, createRecorder, onState, submit, onError, maxDuration });
    this.session = null; this.generation = 0;
  }
  get active() { return Boolean(this.session); }
  async start(source) {
    if (this.active) return;
    const session = { source, generation: ++this.generation, chunks: [] }; this.session = session;
    const current = () => this.session === session && !session.cancelled;
    this.onState('preparing');
    try {
      await this.prepare();
      if (!current()) return;
      session.stream = await this.getStream();
      if (!current()) { this.closeStream(session); return; }
      const recorder = session.recorder = this.createRecorder(session.stream);
      recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
      recorder.onerror = () => { if (current()) { this.cancel(); this.onError(new Error('The microphone stopped unexpectedly. Please try again.')); } };
      recorder.onstop = async () => {
        this.closeStream(session);
        if (this.session === session) { this.session = null; this.onState('idle'); }
        if (session.cancelled || session.generation !== this.generation) return;
        try {
          const blob = new Blob(session.chunks, { type: recorder.mimeType });
          if (blob.size < 1000) throw new Error('That recording was very short. Hold the key while speaking, then release it.');
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (session.generation === this.generation) await this.submit(bytes);
        } catch (error) { if (session.generation === this.generation) this.onError(error); }
      };
      recorder.start(250); this.onState('recording');
      session.timer = setTimeout(() => this.finish(source), this.maxDuration);
    } catch (error) {
      this.closeStream(session);
      if (current()) { this.cancel(); this.onError(error); }
    }
  }
  finish(source) {
    const session = this.session;
    if (!session || session.source !== source || session.finishing) return;
    if (session.recorder?.state !== 'recording') { this.cancel(); return; }
    session.finishing = true; clearTimeout(session.timer);
    this.onState('sending'); session.recorder.stop();
  }
  closeStream(session) { clearTimeout(session.timer); session.stream?.getTracks().forEach(track => track.stop()); }
  cancel() {
    this.generation++;
    const session = this.session; this.session = null;
    if (session) {
      session.cancelled = true;
      if (session.recorder?.state === 'recording') session.recorder.stop();
      this.closeStream(session);
    }
    this.onState('idle');
  }
}
