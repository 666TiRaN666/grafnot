import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Budget guard for the JS bundle (d3-force must stay a small slice of it).
// Total covers every lazy chunk; INITIAL caps the first-paint entry so the
// Tiptap/d3 split keeps paying off.
const BUDGET = 240 * 1024;
const INITIAL_BUDGET = 200 * 1024;
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

let total = 0;
let initial = 0;
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const gz = gzipSync(readFileSync(join(dir, f))).length;
  total += gz;
  if (/^index-[A-Za-z0-9_-]+\.js$/.test(f)) initial += gz;
  console.log(`${f}: ${(gz / 1024).toFixed(1)} KB gzip`);
}
console.log(`total JS gzip: ${(total / 1024).toFixed(1)} KB / budget ${(BUDGET / 1024).toFixed(1)} KB`);
console.log(`initial entry gzip: ${(initial / 1024).toFixed(1)} KB / budget ${(INITIAL_BUDGET / 1024).toFixed(1)} KB`);
if (total > BUDGET) {
  console.error('OVER WEIGHT BUDGET');
  process.exit(1);
}
if (initial > INITIAL_BUDGET) {
  console.error('OVER INITIAL WEIGHT BUDGET');
  process.exit(1);
}
console.log('weight OK');
