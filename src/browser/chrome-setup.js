import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function installChromeHost({ directory, executable, relayPath, extensionDirectory, socketPath, home = os.homedir() }) {
  const identity = JSON.parse(await fs.readFile(path.join(extensionDirectory, 'identity.json'), 'utf8'));
  const folder = path.join(directory, 'chrome-extension');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.cp(extensionDirectory, folder, { recursive: true });
  const launcher = path.join(directory, 'chrome-host.sh');
  await fs.writeFile(launcher, `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ${quote(executable)} ${quote(relayPath)} ${quote(socketPath)} ${quote(identity.id)} "$@"\n`, { mode: 0o700 });
  await fs.chmod(launcher, 0o700);
  const hosts = path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
  await fs.mkdir(hosts, { recursive: true });
  await fs.writeFile(path.join(hosts, 'com.svara.browser.json'), JSON.stringify({ name: 'com.svara.browser', description: 'Svara accessible browsing', path: launcher,
    type: 'stdio', allowed_origins: [`chrome-extension://${identity.id}/`] }, null, 2), { mode: 0o600 });
  return { extensionId: identity.id, folder };
}
