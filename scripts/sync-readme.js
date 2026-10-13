// README sync checker: numbers in both READMEs (unit totals, e2e count,
// per-file byte sizes and test counts) are derived from code, never hand-kept.
// Usage: node scripts/sync-readme.js        — check only, exits 1 on drift
//        node scripts/sync-readme.js --write — patch the numbers in place
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.argv.includes('--write');
const here = dirname(fileURLToPath(import.meta.url));
const proto = join(here, '..');
const src = join(proto, 'src');
const rootReadme = join(proto, '..', 'README.md');
const protoReadme = join(proto, 'README.md');

function ru(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function vitestFacts() {
  const out = join(tmpdir(), 'sync-readme-vitest.json');
  try {
    // node directly (npx needs a shell on Windows, execFile has none).
    execFileSync(process.execPath, [join(proto, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', `--outputFile=${out}`], { cwd: proto, stdio: 'pipe' });
  } catch {
    // A red suite still writes the report; the npm test gate owns failures.
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const perFile = {};
  for (const f of report.testResults || []) {
    const base = f.name.split(/[\\/]/).pop();
    perFile[base] = (f.assertionResults || []).length;
  }
  const total = report.numTotalTests ?? Object.values(perFile).reduce((a, b) => a + b, 0);
  return { perFile, total, files: Object.keys(perFile).length };
}

function e2eCount() {
  const srcTxt = readFileSync(join(proto, 'e2e', 'check6.cjs'), 'utf8');
  return (srcTxt.match(/await check\(/g) || []).length;
}

const drifts = [];
function wrong(where, what, have, want) {
  if (String(have) !== String(want)) drifts.push(`${where}: ${what} is ${have}, want ${want}`);
}

function subAll(text, re, to) {
  let out = text;
  let n = 0;
  out = out.replace(re, (...a) => {
    n++;
    return typeof to === 'function' ? to(...a) : to;
  });
  return { out, n };
}

const facts = vitestFacts();
const e2e = e2eCount();

// ---------- root README ----------
let root = readFileSync(rootReadme, 'utf8');

// Unit totals: "Unit (vitest, 88, 16 файлов)"
{
  const m = root.match(/Unit \(vitest, (\d+), (\d+) файл(?:ов|а|)\)/);
  if (m) {
    wrong('root README', 'unit total', m[1], facts.total);
    wrong('root README', 'unit files', m[2], facts.files);
    if (WRITE) {
      const r = subAll(root, /Unit \(vitest, \d+, \d+ файл(?:ов|а|)\)/, `Unit (vitest, ${facts.total}, ${facts.files} ${ru(facts.files, 'файл', 'файла', 'файлов')})`);
      root = r.out;
    }
  } else {
    drifts.push('root README: Unit totals pattern not found');
  }
}

// E2E total in the P-breakdown: "61 проверка/проверки/проверок"
// (stem alternates: провер-к-а/провер-к-и but провер-ок).
{
  const m = root.match(/(\d+) провер(?:ка|ки|ок)/);
  if (m) {
    wrong('root README', 'e2e total', m[1], e2e);
    if (WRITE) {
      const r = subAll(root, /(\d+) провер(?:ка|ки|ок)/, `${e2e} провер${ru(e2e, 'ка', 'ки', 'ок')}`);
      root = r.out;
    }
  } else {
    drifts.push('root README: e2e total pattern not found');
  }
}

// "58 e2e" in the scripts row.
{
  const m = root.match(/(dead-key чекер; )(\d+)( e2e;)/);
  if (m) {
    wrong('root README', 'scripts-row e2e', m[2], e2e);
    if (WRITE) root = root.replace(/(dead-key чекер; )\d+( e2e;)/, (_s, a, b) => `${a}${e2e}${b}`);
  }
}

// Per-file byte sizes and test counts in the file table:
// | `name` | 1234 | ... — bytes resolve under src/ first, then prototype root.
{
  const lines = root.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('|');
    if (cells.length < 4) continue;
    const nameM = cells[1].match(/`([^`]+)`/);
    const bytesM = cells[2].match(/^\s*(\d+)\s*$/);
    if (!nameM || !bytesM) continue;
    const name = nameM[1];
    const cand = [join(src, name), join(proto, name)];
    const hit = cand.find((p) => existsSync(p) && statSync(p).isFile());
    if (!hit) {
      drifts.push(`root README: cannot resolve byte row ${name}`);
      continue;
    }
    const want = statSync(hit).size;
    wrong('root README', `bytes ${name}`, bytesM[1], want);
    if (WRITE) lines[i] = lines[i].replace(/(\| `[^`]+` \| )\d+( \|)/, `$1${want}$2`);
    // Test counts in the description column for *.test.ts rows.
    if (name.endsWith('.test.ts') && facts.perFile[name] !== undefined) {
      const cM = cells[3].match(/(\d+)\s*тест/);
      if (cM) {
        wrong('root README', `tests ${name}`, cM[1], facts.perFile[name]);
        if (WRITE) {
          const n = facts.perFile[name];
          lines[i] = lines[i].replace(/\d+\s*тест[а-я]*/, `${n} тест${ru(n, '', 'а', 'ов')}`);
        }
      }
    }
  }
  if (WRITE) root = lines.join('\n');
}

// ---------- prototype README ----------
let protoTxt = readFileSync(protoReadme, 'utf8');

// "57 тестов ядра" / "70 тестов UX..." — groups are the file lists on those lines
// (bare names without the suffix are completed to *.test.ts; *.test.js kept).
function normTest(f) {
  const t = f.trim();
  if (!t) return '';
  if (t.endsWith('.test.ts') || t.endsWith('.test.js')) return t;
  return `${t}.test.ts`;
}
function isTestFile(s) {
  return s.endsWith('.test.ts') || s.endsWith('.test.js');
}
function protoGroup(lineRe) {
  const line = protoTxt.split('\n').find((l) => lineRe.test(l));
  if (!line) return null;
  const files = line.split('—')[0].split(/[,/]/).map(normTest).filter(isTestFile);
  const nM = line.match(/(\d+)\s*тест/);
  return { files, have: nM ? nM[1] : null, line };
}
// Group stems alternate with the count (66 тестов / 74 теста), like the e2e line.
const RE_CORE = /тест[а-я]* ядра/;
const RE_UX = /тест[а-я]* UX/;
for (const re of [RE_CORE, RE_UX]) {
  const g = protoGroup(re);
  if (!g) {
    drifts.push(`proto README: group pattern ${re} not found`);
    continue;
  }
  const missing = g.files.filter((f) => facts.perFile[f] === undefined);
  if (missing.length > 0) drifts.push(`proto README: group files without tests: ${missing.join(', ')}`);
  const want = g.files.reduce((a, f) => a + (facts.perFile[f] || 0), 0);
  wrong('proto README', `group ${re}`, g.have, want);
  if (WRITE) protoTxt = protoTxt.replace(g.line, g.line.replace(/\d+\s*тест[а-я]*/, `${want} тест${ru(want, '', 'а', 'ов')}`));
}
// Test files in neither group must be assigned by hand (script refuses to guess).
{
  const grouped = new Set();
  for (const re of [RE_CORE, RE_UX]) {
    const line = protoTxt.split('\n').find((l) => re.test(l));
    if (line) line.split('—')[0].split(/[,/]/).map(normTest).forEach((f) => grouped.add(f));
  }
  const orphans = Object.keys(facts.perFile).filter((f) => !grouped.has(f));
  if (orphans.length > 0) drifts.push(`proto README: ungrouped test files: ${orphans.join(', ')}`);
}
// "61 e2e-проверка/проверки/проверок" (stem alternates like above).
{
  const m = protoTxt.match(/(\d+) e2e-провер(?:ка|ки|ок)/);
  if (m) {
    wrong('proto README', 'e2e total', m[1], e2e);
    if (WRITE) protoTxt = protoTxt.replace(/(\d+) e2e-провер(?:ка|ки|ок)/, `${e2e} e2e-провер${ru(e2e, 'ка', 'ки', 'ок')}`);
  } else {
    drifts.push('proto README: e2e total pattern not found');
  }
}

if (WRITE) {
  writeFileSync(rootReadme, root);
  writeFileSync(protoReadme, protoTxt);
  console.log(`sync-readme: wrote (unit ${facts.total}/${facts.files}, e2e ${e2e})`);
}
if (drifts.length > 0) {
  console.log('sync-readme drifts:');
  for (const d of drifts) console.log(' - ' + d);
  process.exit(1);
}
console.log(`sync-readme OK (unit ${facts.total}/${facts.files}, e2e ${e2e})`);
