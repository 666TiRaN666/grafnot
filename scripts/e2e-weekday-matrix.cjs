// T2 weekday matrix: S5 group + task-list checks under a fixed page clock.
// Usage: npm run e2e:matrix   (preview on :5199 must be up; NOT part of CI)
const { spawnSync } = require('child_process');

const DATES = [
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
  '2026-10-16', '2026-10-17', '2026-10-18',
  '2026-10-31', '2026-11-01', '2026-12-28', '2026-12-31', '2027-01-03',
];
const GROUPS = 'G21-week,G20-plan';

const rows = [];
let allGreen = true;
for (const d of DATES) {
  const r = spawnSync('node', ['e2e/check6.cjs'], {
    cwd: __dirname + '/..',
    env: { ...process.env, E2E_FIXED_CLOCK: d + 'T10:00:00', GROUPS, CHECK: '' },
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
  });
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL '));
  const passed = out.split('\n').filter((l) => l.startsWith('PASS ')).length;
  const total = out.match(/(\d+)\/(\d+) passed/);
  const ok = fails.length === 0;
  if (!ok) allGreen = false;
  rows.push({ date: d, ok, passed, total: total ? total[0] : '?', fails: fails.map((f) => f.slice(5, 90)) });
  console.log(`${d}  ${ok ? 'GREEN' : 'RED ' + fails.length}  ${total ? total[0] : '?'}`);
  for (const f of fails) console.log(`    ${f.slice(0, 120)}`);
}
console.log(allGreen ? 'MATRIX: all green' : 'MATRIX: failures present');
process.exit(allGreen ? 0 : 1);
