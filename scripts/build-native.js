import { execFileSync } from 'node:child_process';
import { mkdir, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

if (process.platform === 'darwin') {
  const cache = path.join(os.homedir(), 'Library/Caches/node-gyp');
  const include = path.join(cache, process.versions.node, 'include/node');
  try { await access(path.join(include, 'node_api.h')); }
  catch { execFileSync(process.execPath, ['node_modules/node-gyp/bin/node-gyp.js', 'install', '--ensure', '--devdir', cache], { stdio: 'inherit' }); }
  const test = process.argv.includes('--test'), directory = test ? 'build/native-tests' : 'build/native';
  await mkdir(directory, { recursive: true });
  execFileSync('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
    '-mmacosx-version-min=12.0', '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8',
    '-DNODE_GYP_MODULE_NAME=svara_key_release', ...(test ? ['-DSVARA_NATIVE_TEST'] : []), '-I', include,
    '-framework', 'Carbon', 'src/native/key-release.c', '-o', `${directory}/key-release.node`], { stdio: 'inherit' });
  if (!test) await unlink('build/native/key-release').catch(error => { if (error.code !== 'ENOENT') throw error; });
  execFileSync('xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', '-fobjc-arc',
    '-mmacosx-version-min=12.0', '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8',
    '-DNODE_GYP_MODULE_NAME=svara_language', '-I', include, '-framework', 'Foundation', '-framework', 'NaturalLanguage',
    'src/native/language.m', '-o', `${directory}/language.node`], { stdio: 'inherit' });
}
