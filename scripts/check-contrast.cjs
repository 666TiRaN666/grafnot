// WCAG AA contrast guard for S1 tokens (no dependencies).
// Checks text pairs defined as --u-* in src/ui/tokens.css, both themes.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'tokens.css'), 'utf8');

function block(theme) {
  const re = new RegExp(`\\.g-app\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`, 's');
  const m = css.match(re);
  if (!m) throw new Error('theme block missing: ' + theme);
  const vars = {};
  for (const vm of m[1].matchAll(/(--u-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) vars[vm[1]] = vm[2];
  return vars;
}

function lum(hex) {
  const c = hex.replace('#', '');
  const f = (i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
}
function ratio(a, b) {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// [fg, bg, minimum]: text pairs 4.5:1; control boundaries, status dots and
// the focus ring 3:1 (WCAG 1.4.11). W5 adds the «Лист» roles
// (docs/actual/Stage3_Visual_System.md §2, §13).
const PAIRS = [
  ['--u-text', '--u-bg'],
  ['--u-muted', '--u-bg'],
  ['--u-on-accent', '--u-accent'],
  ['--u-on-danger', '--u-danger'],
  ['--u-text', '--u-card'],
  ['--u-text', '--u-sel'],
  ['--u-text', '--u-hover'],
  ['--u-muted', '--u-card'],
  ['--u-muted', '--u-sel'],
  ['--u-muted', '--u-hover'],
  ['--u-subtle', '--u-card'],
  ['--u-subtle', '--u-bg'],
  ['--u-subtle', '--u-sel'],
  ['--u-accent', '--u-card'],
  ['--u-accent', '--u-bg'],
  ['--u-accent', '--u-sel'],
  ['--u-accent', '--u-accent-soft'],
  ['--u-danger', '--u-card'],
  ['--u-warn', '--u-warn-soft'],
  ['--u-warn', '--u-card'],
  ['--u-ok', '--u-card', 3],
  ['--u-control', '--u-card', 3],
  ['--u-control', '--u-bg', 3],
  ['--u-control', '--u-hover', 3],
  ['--u-focus', '--u-card', 3],
  ['--u-focus', '--u-bg', 3],
  // 2026-11: the rail has its own surface (--u-side).
  ['--u-text', '--u-side'],
  ['--u-muted', '--u-side'],
  ['--u-accent', '--u-side'],
  ['--u-muted', '--u-accent-soft'],
  ['--u-subtle', '--u-hover'],
];

let fail = 0;
for (const theme of ['light', 'dark']) {
  const vars = block(theme);
  for (const [fg, bg, min = 4.5] of PAIRS) {
    if (!vars[fg] || !vars[bg]) {
      console.error(`MISSING ${theme} ${fg} or ${bg}`);
      fail++;
      continue;
    }
    const r = ratio(vars[fg], vars[bg]);
    const ok = r >= min;
    console.log(`${theme} ${fg}/${bg}: ${r.toFixed(2)} ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail++;
  }
}
// 2026-11: index.css no longer holds its own colours. Its legacy names are
// aliases of --u-* (one token set), so the pairs above cover the app. The
// contract checked here: every legacy name points at its --u-* token, and
// text on the accent uses --u-on-accent (white failed at 2.8:1 in dark).
const appCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8');
const ALIASES = {
  '--bg': '--u-bg', '--card': '--u-card', '--text': '--u-text', '--muted': '--u-muted', '--faint': '--u-subtle',
  '--border': '--u-border', '--border-soft': '--u-line', '--accent': '--u-accent', '--accent-ink': '--u-accent',
  '--accent-soft': '--u-accent-soft', '--ok': '--u-ok', '--warn': '--u-warn', '--warn-soft': '--u-warn-soft', '--danger': '--u-danger',
};
for (const [legacy, token] of Object.entries(ALIASES)) {
  const ok = new RegExp(`${legacy}:\\s*var\\(${token}\\)`).test(appCss);
  console.log(`alias ${legacy} -> ${token}: ${ok ? 'OK' : 'FAIL'}`);
  if (!ok) fail++;
}
const raw = appCss.match(/\.g-app\[data-theme='(light|dark)'\][^{]*\{[^}]*--(muted|faint|accent|border)\s*:\s*#[0-9a-fA-F]{3,6}/);
if (raw) { console.error('legacy colour redefined with a raw hex: ' + raw[0].slice(0, 80)); fail++; }
const primary = /\.g-btn\.primary\s*\{[^}]*color:\s*var\(--u-on-accent\)/.test(appCss);
console.log(`.g-btn.primary text uses --u-on-accent: ${primary ? 'OK' : 'FAIL'}`);
if (!primary) fail++;
if (fail > 0) {
  console.error(`contrast FAIL (${fail})`);
  process.exit(1);
}
console.log('contrast OK');
