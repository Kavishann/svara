import fs from 'node:fs/promises';
import { collectPage } from '../src/browser/snapshot.js';
const source = 'src/chrome-extension', destination = 'build/chrome-extension';
const identity = JSON.parse(await fs.readFile(`${source}/identity.json`, 'utf8'));
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
await fs.mkdir(destination, { recursive: true });
for (const name of ['identity.json', 'worker.js', 'content.js', 'welcome.html', 'welcome.js', 'welcome.css']) await fs.copyFile(`${source}/${name}`, `${destination}/${name}`);
await fs.writeFile(`${destination}/collector.js`, `globalThis.svaraCollectPage = ${collectPage.toString()};\n`);
await fs.writeFile(`${destination}/manifest.json`, JSON.stringify({ manifest_version: 3, name: 'Svara browser companion', version, key: identity.key,
  description: 'Connect ordinary Chrome to Svara for Sinhala voice browsing and keyboard page reading.', minimum_chrome_version: '120',
  permissions: ['nativeMessaging', 'tabs', 'scripting', 'storage', 'alarms'], host_permissions: ['http://*/*', 'https://*/*'],
  background: { service_worker: 'worker.js' }, action: { default_title: 'Connect Svara' } }, null, 2));
console.log('Svara Chrome companion built.');
