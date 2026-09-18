import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const directory = 'build/icon.iconset';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<style>body{margin:0;background:transparent}</style>${await readFile('build/icon.svg', 'utf8')}`);
  await page.screenshot({ path: `${directory}/icon_512x512@2x.png`, omitBackground: true });
} finally { await browser.close(); }
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    if (size === 512 && scale === 2) continue;
    execFileSync('sips', ['-z', String(size * scale), String(size * scale), `${directory}/icon_512x512@2x.png`, '--out', `${directory}/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', directory, '-o', 'build/icon.icns']);
console.log('Mac app icon created.');
