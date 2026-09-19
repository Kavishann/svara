import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyMac(appPath) {
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  const main = path.join(appPath, 'Contents/MacOS/Svara');
  const architectures = execFileSync('/usr/bin/lipo', ['-archs', main], { encoding: 'utf8' }).trim().split(/\s+/);
  for (const name of ['key-release.node', 'language.node']) {
    const native = path.join(appPath, 'Contents/Resources/native', name);
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', native], { stdio: 'inherit' });
    for (const architecture of architectures) execFileSync('/usr/bin/lipo', [native, '-verify_arch', architecture], { stdio: 'inherit' });
  }
  console.log('Mac app signature, resource seal, and native helper architectures verified.');
  console.log('A valid local signature does not provide Apple notarization or Developer ID trust.');
}

export default function afterSign(context) {
  if (context.electronPlatformName === 'darwin') verifyMac(path.join(context.appOutDir, 'Svara.app'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyMac(path.resolve(process.argv[2] || 'dist/mac-arm64/Svara.app'));
}
