import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(file);
    else if (/\.(js|cjs)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
await check('src'); await check('scripts'); await check('test');
for (const line of (await readFile('.env.example', 'utf8')).split('\n')) {
  const assignment = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (assignment && !['', '""', "''"].includes(assignment[2])) {
    throw new Error(`Keep ${assignment[1]} empty in .env.example. Save personal credentials in Svara Connections or an ignored local .env file.`);
  }
}
console.log('All JavaScript files passed syntax checks. Example environment values are empty.');
