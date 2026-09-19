import { spawn } from 'node:child_process';

export class LocalReading {
  constructor({ launch = (...args) => spawn(...args) } = {}) { this.launch = launch; this.current = null; }
  play(text, rate = 1) {
    this.stop();
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 12000) throw new Error('Use a short reading passage.');
    return new Promise((resolve, reject) => {
      const job = { process: null, finish: null }; this.current = job;
      job.finish = (completed, error) => {
        if (this.current !== job) return;
        this.current = null;
        if (error) reject(new Error('The Mac voice could not read this item. Check that the Samantha English voice is installed in macOS.'));
        else resolve(completed);
      };
      try {
        const speed = Math.round(190 * Math.max(0.6, Math.min(2, Number(rate) || 1)));
        job.process = this.launch('/usr/bin/say', ['-v', 'Samantha', '-r', String(speed)], { stdio: ['pipe', 'ignore', 'ignore'] });
        job.process.once('error', error => job.finish(false, error));
        job.process.once('exit', code => job.finish(code === 0, code !== 0));
        job.process.stdin.on('error', error => job.finish(false, error));
        // Use stdin, never a shell or command arguments. Prevent a web page's
        // Apple speech markup from changing volume or inserting long pauses.
        job.process.stdin.end(text.replaceAll('[[', '[ [').replaceAll(']]', '] ]'));
      } catch (error) { job.finish(false, error); }
    });
  }
  stop() {
    const job = this.current;
    if (!job) return;
    job.finish(false); job.process?.kill();
  }
}
