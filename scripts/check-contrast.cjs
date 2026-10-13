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

const PAIRS = [
  ['--u-text', '--u-bg'],
  ['--u-muted', '--u-bg'],
  ['--u-on-accent', '--u-accent'],
  ['--u-on-danger', '--u-danger'],
];

let fail = 0;
for (const theme of ['light', 'dark']) {
  const vars = block(theme);
  for (const [fg, bg] of PAIRS) {
    if (!vars[fg] || !vars[bg]) {
      console.error(`MISSING ${theme} ${fg} or ${bg}`);
      fail++;
      continue;
    }
    const r = ratio(vars[fg], vars[bg]);
    const ok = r >= 4.5;
    console.log(`${theme} ${fg}/${bg}: ${r.toFixed(2)} ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail++;
  }
}
// S12: real app theme tokens in src/index.css (both themes) — the u-*
// primitives above are unused by pages, so gating them alone is theater.
const appCss = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8');
function appBlock(theme) {
  const re = new RegExp(`\\.g-app\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`, 's');
  const m = appCss.match(re);
  if (!m) throw new Error('app theme block missing: ' + theme);
  const vars = {};
  for (const vm of m[1].matchAll(/(--[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) vars[vm[1]] = vm[2];
  return vars;
}
const APP_PAIRS = [
  ['--text', '--bg'],
  ['--text', '--card'],
  ['--muted', '--bg'],
  ['--muted', '--card'],
  ['--faint', '--bg'],
  ['--faint', '--card'],
  ['--accent-ink', '--accent-soft'],
  ['--danger', '--card'],
  ['--ok', '--card'],
  ['--warn', '--card'],
];
for (const theme of ['light', 'dark']) {
  const vars = appBlock(theme);
  for (const [fg, bg] of APP_PAIRS) {
    if (!vars[fg] || !vars[bg]) {
      console.error(`MISSING app ${theme} ${fg} or ${bg}`);
      fail++;
      continue;
    }
    const r = ratio(vars[fg], vars[bg]);
    const ok = r >= 4.5;
    console.log(`app-${theme} ${fg}/${bg}: ${r.toFixed(2)} ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) fail++;
  }
}
// Primary buttons: light theme uses #fff on --accent; dark theme must use
// dark text (white on the dark accent is ~2.8). The rule below is the contract.
const lightVars = appBlock('light');
const darkVars = appBlock('dark');
const wl = ratio('#ffffff', lightVars['--accent']);
console.log(`app-light #fff/--accent: ${wl.toFixed(2)} ${wl >= 4.5 ? 'OK' : 'FAIL'}`);
if (wl < 4.5) fail++;
const dd = ratio('#0e1013', darkVars['--accent']);
console.log(`app-dark #0e1013/--accent: ${dd.toFixed(2)} ${dd >= 4.5 ? 'OK' : 'FAIL'}`);
if (dd < 4.5) fail++;
if (!/\.g-app\[data-theme='dark'\]\s*\.g-btn\.primary\s*\{[^}]*color:\s*#0e1013/.test(appCss)) {
  console.error('MISSING app dark .g-btn.primary dark-text rule');
  fail++;
} else {
  console.log('app-dark .g-btn.primary dark-text rule: OK');
}
if (fail > 0) {
  console.error(`contrast FAIL (${fail})`);
  process.exit(1);
}
console.log('contrast OK');
