import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_SHORTCUTS, normalizeShortcuts } from './core/shortcuts.js';

const publicSchema = z.object({
  projectId: z.string().max(120).regex(/^[a-zA-Z0-9:_-]*$/),
  region: z.enum(['asia-southeast1', 'us-central1', 'europe-west4']),
  inputLanguage: z.enum(['si-LK', 'en-US']),
  voice: z.enum(['Kore', 'Puck', 'Aoede', 'Charon', 'Fenrir', 'Leda']),
  guidanceLanguage: z.enum(['si-LK', 'en-US']),
  speechEnabled: z.boolean(),
  rate: z.number().min(0.6).max(2),
  shortcuts: z.unknown().transform(normalizeShortcuts).optional(),
  geminiKey: z.string().max(500).optional(),
  typesafeKey: z.string().max(500).optional(),
  clearKeys: z.boolean().optional()
}).strict();

export class Settings {
  constructor(directory, safeStorage) {
    this.directory = directory; this.safeStorage = safeStorage;
    this.data = { projectId: '', region: 'asia-southeast1', inputLanguage: 'si-LK', voice: 'Kore',
      guidanceLanguage: 'si-LK', speechEnabled: true, rate: 1, credentialsPath: '', geminiKey: '', typesafeKey: '',
      shortcuts: normalizeShortcuts(DEFAULT_SHORTCUTS) };
  }
  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(path.join(this.directory, 'settings.json'), 'utf8'));
      const { encryptedSecrets, credentialsPath, ...plain } = saved;
      Object.assign(this.data, publicSchema.parse(plain), { credentialsPath: typeof credentialsPath === 'string' ? credentialsPath : '' });
      if (encryptedSecrets && this.safeStorage.isEncryptionAvailable()) {
        Object.assign(this.data, JSON.parse(this.safeStorage.decryptString(Buffer.from(encryptedSecrets, 'base64'))));
      }
    } catch (e) { if (e.code !== 'ENOENT') this.loadWarning = 'Saved settings could not be read. Reconnect your services.'; }
    this.data.geminiKey ||= process.env.GEMINI_API_KEY || '';
    this.data.typesafeKey ||= process.env.TYPESAFE_API_KEY || '';
    this.data.projectId ||= process.env.GOOGLE_CLOUD_PROJECT || '';
    this.data.credentialsPath ||= process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  }
  public() {
    const { geminiKey, typesafeKey, credentialsPath, ...rest } = this.data;
    return { ...rest, hasGeminiKey: Boolean(geminiKey), hasTypesafeKey: Boolean(typesafeKey),
      credentialFile: credentialsPath ? path.basename(credentialsPath) : '',
      encryptedStorage: this.safeStorage.isEncryptionAvailable(), warning: this.loadWarning || '' };
  }
  async save(input) {
    const parsed = publicSchema.parse(input);
    const { geminiKey, typesafeKey, clearKeys, ...plain } = parsed;
    const next = { ...this.data, ...plain };
    if (clearKeys) { next.geminiKey = ''; next.typesafeKey = ''; }
    if (geminiKey) next.geminiKey = geminiKey.trim();
    if (typesafeKey) next.typesafeKey = typesafeKey.trim();
    await this.persist(next);
    this.data = next;
    return this.public();
  }
  async setCredentialFile(file) {
    const next = { ...this.data, credentialsPath: file };
    await this.persist(next); this.data = next; return this.public();
  }
  async saveShortcuts(input) {
    const next = { ...this.data, shortcuts: normalizeShortcuts(input) };
    await this.persist(next); this.data = next; return this.public();
  }
  async persist(data) {
    const { geminiKey, typesafeKey, ...plain } = data;
    if ((geminiKey || typesafeKey) && !this.safeStorage.isEncryptionAvailable()) {
      throw new Error('macOS secure storage is unavailable. Credentials have not been saved.');
    }
    const encryptedSecrets = geminiKey || typesafeKey
      ? this.safeStorage.encryptString(JSON.stringify({ geminiKey, typesafeKey })).toString('base64') : '';
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, 'settings.json');
    await fs.writeFile(file + '.tmp', JSON.stringify({ ...plain, encryptedSecrets }, null, 2), { mode: 0o600 });
    await fs.rename(file + '.tmp', file);
  }
}
