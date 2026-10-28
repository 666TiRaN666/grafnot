// T2 weekday matrix: S5 group + task-list checks under a fixed page clock.
// Usage: npm run e2e:matrix   (NOT part of CI)
// Builds dist/, starts its own preview on :5199 (a busy port fails the run),
// runs every date and stops the preview. A date is green only when the child
// finished in time and reported every check the manifest owes (D4).
const { spawnSync } = require('child_process');
const path = require('path');
const { judgeRun, e2eEnv, startPreview, stopPreview } = require('./runner-lib.cjs');
const { expectedFor } = require('../e2e/manifest.cjs');

const ROOT = path.join(__dirname, '..');
const DATES = [
  '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15',
  '2026-10-16', '2026-10-17', '2026-10-18',
  '2026-10-31', '2026-11-01', '2026-12-28', '2026-12-31', '2027-01-03',
];
const GROUPS = 'G21-week,G20-plan';
const RUN_TIMEOUT = 20 * 60 * 1000;

async function main() {
  const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: ROOT, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  if (build.error || build.status !== 0) {
    console.log('MATRIX: build failed — ' + (build.error ? build.error.message : 'exit ' + build.status));
    console.log(((build.stdout || '') + (build.stderr || '')).trim().split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  let preview = null;
  process.on('SIGINT', () => {
    stopPreview(preview).finally(() => process.exit(130));
  });
  try {
    preview = await startPreview(ROOT);
  } catch (e) {
    console.log('MATRIX: ' + e.message);
    process.exit(1);
  }

  let green = 0;
  try {
    for (const d of DATES) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'e2e', 'check6.cjs')], {
        cwd: ROOT,
        env: Object.assign(e2eEnv(GROUPS, process.env), { E2E_FIXED_CLOCK: d + 'T10:00:00' }),
        encoding: 'utf8',
        timeout: RUN_TIMEOUT,
      });
      const out = (r.stdout || '') + '\n' + (r.stderr || '');
      const v = judgeRun({ status: r.status, signal: r.signal, error: r.error, out }, expectedFor(GROUPS));
      if (v.ok) green++;
      console.log(`${d}  ${v.ok ? 'GREEN' : 'RED  '}  ${v.reason}`);
      if (!v.ok) {
        for (const f of out.replace(/\r/g, '').split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 10)) console.log(`    ${f.slice(0, 120)}`);
      }
    }
  } finally {
    const stop = await stopPreview(preview);
    preview = null;
    if (!stop.ok) {
      console.log('MATRIX: ' + stop.reason);
      green = -1;
    }
  }
  const allGreen = green === DATES.length;
  console.log(allGreen ? `MATRIX: all green (${green}/${DATES.length})` : `MATRIX: failures present (${Math.max(green, 0)}/${DATES.length} green)`);
  process.exit(allGreen ? 0 : 1);
}

main().catch((e) => {
  console.error('MATRIX FATAL', e);
  process.exit(2);
});
