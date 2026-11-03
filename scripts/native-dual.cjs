// Dual-OS node_modules: the checkout lives on a disk shared by Linux and
// Windows, so one node_modules must carry the native bindings of both.
// npm ci installs only the current platform's optional binding; this adds
// the other platform's ones at the versions pinned in package-lock.json.
// Usage: npm ci, then npm run deps:dual (from either OS).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const lock = require(path.join(ROOT, 'package-lock.json')).packages;
const other = process.platform === 'win32'
  ? ['@rolldown/binding-linux-x64-gnu', 'lightningcss-linux-x64-gnu', '@oxlint/binding-linux-x64-gnu']
  : ['@rolldown/binding-win32-x64-msvc', 'lightningcss-win32-x64-msvc', '@oxlint/binding-win32-x64-msvc'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grafnot-native-'));

try {
  for (const name of other) {
    const entry = lock['node_modules/' + name];
    if (!entry) { console.log('skip ' + name + ' (not in lockfile)'); continue; }
    const dest = path.join(ROOT, 'node_modules', name);
    const have = path.join(dest, 'package.json');
    if (fs.existsSync(have) && JSON.parse(fs.readFileSync(have, 'utf8')).version === entry.version) {
      console.log('ok   ' + name + '@' + entry.version);
      continue;
    }
    const tgz = execFileSync(npm, ['pack', name + '@' + entry.version, '--silent', '--pack-destination', tmp],
      { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split(/\r?\n/).pop();
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', dest, '--strip-components=1']);
    console.log('add  ' + name + '@' + entry.version);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
