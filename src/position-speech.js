import { spawn } from 'node:child_process';

// Only an item number reaches macOS speech. Page text never enters this path.
export class PositionSpeech {
  constructor({ launch = (...args) => spawn(...args), onFailure = () => {}, delay = 35 } = {}) {
    Object.assign(this, { launch, onFailure, delay });
    this.current = null;
  }
  speak(number) {
    this.stop();
    if (!Number.isInteger(number) || number < 1 || number > 10000) return;
    const job = { timer: null, process: null }; this.current = job;
    job.timer = setTimeout(() => {
      if (this.current !== job) return;
      const finished = failed => {
        if (this.current !== job) return;
        this.current = null;
        if (failed) this.onFailure();
      };
      try {
        job.process = this.launch('/usr/bin/say', ['-v', 'Samantha', '-r', '230', String(number)], { stdio: 'ignore' });
        job.process.once('error', () => finished(true));
        job.process.once('exit', (code, signal) => finished(code !== 0 && !signal));
      } catch { finished(true); }
    }, this.delay);
  }
  stop() {
    const job = this.current; this.current = null;
    if (!job) return;
    clearTimeout(job.timer);
    job.process?.kill();
  }
}

export const positionSpeech = new PositionSpeech();
