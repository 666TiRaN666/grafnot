// Portable Chrome/Chromium resolver (P5'): CHROME_PATH wins, then
// well-known install locations per platform. Shared by e2e/check6.cjs and
// scripts/audit-targets.cjs so CI (Ubuntu, google-chrome) and Windows agree.
const fs = require('fs');

const candidates = [];
if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
if (process.platform === 'win32') {
  candidates.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
} else {
  candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/opt/google/chrome/chrome');
}
// Last resort on any OS: the Chromium build installed by
// `npx playwright-core install chromium` (cache path resolved by playwright).
try { candidates.push(require('playwright-core').chromium.executablePath()); } catch { /* not installed */ }
for (const c of candidates) {
  try {
    if (c && fs.existsSync(c)) {
      module.exports = c;
      return;
    }
  } catch { /* try next */ }
}
console.error('E2E misconfigured: no Chrome/Chromium found (tried: ' + candidates.join(', ') + ') — set CHROME_PATH env');
process.exit(2);
