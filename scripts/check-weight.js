import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline } from './weight-guard.js';

// Weight reporter + fuse (W1: no hard limits).
// Prints per-file gzip with roles (entry = initial chunk, preload =
// modulepreload of dist/index.html, lazy = the rest) plus total/initial sums.
// docs/weight-baseline.json pins the accepted sizes: growth above 15% warns
// (exit 0), above 50% fails (exit 1). --update re-pins the baseline (manual).
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'dist', 'assets');
const baselinePath = join(here, '..', 'docs', 'weight-baseline.json');

const UPDATE = process.argv.includes('--update');

function preloadSet() {
  try {
    const html = readFileSync(join(here, '..', 'dist', 'index.html'), 'utf8');
    const out = new Set();
    for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) {
      const base = String(m[1]).split('/').pop();
      if (base) out.add(base);
    }
    return out;
  } catch {
    return new Set();
  }
}

const preload = preloadSet();
let total = 0;
let initial = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const gz = gzipSync(readFileSync(join(dir, f))).length;
  total += gz;
  let role = 'lazy';
  if (/^index-[A-Za-z0-9_-]+\.js$/.test(f)) {
    role = 'entry';
    initial += gz;
  } else if (preload.has(f)) {
    role = 'preload';
  }
  console.log(`${f}: ${(gz / 1024).toFixed(1)} KB gzip [${role}]`);
}
console.log(`total JS gzip: ${(total / 1024).toFixed(1)} KB`);
console.log(`initial entry gzip: ${(initial / 1024).toFixed(1)} KB`);

if (UPDATE) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(baselinePath, JSON.stringify({ total, initial, date: today }, null, 2) + '\n');
  console.log(`baseline updated: ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`weight baseline missing (${baselinePath}), re-pin it manually: node scripts/check-weight.js --update`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
for (const [name, cur, base] of [
  ['total', total, baseline.total],
  ['initial', initial, baseline.initial],
]) {
  const { pct, status } = compareToBaseline(cur, base);
  if (status === 'fail') {
    console.error(`${name} gzip вырос на ${pct.toFixed(1)}% от baseline: вероятно, в бандл попала тяжёлая зависимость`);
    process.exit(1);
  }
  if (status === 'warn') {
    console.log(`вес вырос на ${pct.toFixed(1)}% от baseline (${name})`);
  }
}
console.log('weight reported');
