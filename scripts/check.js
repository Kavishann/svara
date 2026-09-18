import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(file);
    else if (/\.(js|cjs)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
await check('src'); await check('scripts'); await check('test');
console.log('All JavaScript files passed syntax checks.');
