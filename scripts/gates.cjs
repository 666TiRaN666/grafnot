// All gates in one command with a short summary; full output only for failures.
// Usage: npm run gates                      — unit, tsc, oxlint, i18n (+selftest), runner selftest, contrast, README sync
//        npm run gates -- --e2e             — + build, weight, preview :5199, full e2e, N1 audit enforce
//        npm run gates -- --groups=G20-plan,G21-week — + build, weight, preview, these e2e groups only
// The preview server is started and stopped here (by its own PID); a busy :5199
// fails the run instead of testing against a stale server. A full run sets
// GROUPS='' explicitly (an inherited GROUPS must not shrink it), the e2e total
// is checked against e2e/manifest.cjs, and every gate has a time limit.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { judgeRun, e2eEnv, startPreview, stopPreview } = require('./runner-lib.cjs');
const { expectedFor } = require('../e2e/manifest.cjs');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(os.tmpdir(), 'grafnot-gates');
const NODE = process.execPath;
const bin = (...p) => path.join(ROOT, 'node_modules', ...p);
const script = (name) => path.join(ROOT, 'scripts', name);
const MIN = 60 * 1000;

const ESC = String.fromCharCode(27);
const stripAnsi = (s) => s.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('');
const lastLine = (out) => out.trim().split('\n').filter(Boolean).pop() || '';
const count = (out, re) => (out.match(re) || []).length;

/** Gate lists for the given CLI args and parent env (pure: inspected by runner.selftest.cjs). */
function buildGates(args, env) {
  const groupsArg = (args.find((a) => a.startsWith('--groups=')) || '').slice('--groups='.length);
  const withE2E = args.includes('--e2e') || groupsArg !== '';
  const fast = [
    { name: 'unit', cmd: [bin('vitest', 'vitest.mjs'), 'run'], sum: (o) => (o.match(/Tests\s+(.+)/) || [])[1] || lastLine(o) },
    { name: 'tsc', cmd: [bin('typescript', 'bin', 'tsc'), '-b'], sum: (o) => (o.trim() ? lastLine(o) : '0 errors') },
    { name: 'oxlint', cmd: [bin('oxlint', 'bin', 'oxlint')], sum: (o) => `${count(o, / error /g)} errors, ${count(o, / warning /g)} warnings` },
    { name: 'i18n', cmd: [script('check-i18n.js')], sum: lastLine },
    { name: 'i18n-selftest', cmd: [script('check-i18n.selftest.js')], sum: lastLine },
    { name: 'runner', cmd: [script('runner.selftest.cjs')], sum: lastLine },
    { name: 'contrast', cmd: [script('check-contrast.cjs')], sum: lastLine },
    { name: 'readme', cmd: [script('sync-readme.js')], sum: lastLine },
  ];
  const e2e = [
    { name: 'build', cmd: [bin('vite', 'bin', 'vite.js'), 'build'], timeoutMs: 5 * MIN, sum: (o) => (o.match(/built in \S+/) || [])[0] || lastLine(o) },
    {
      name: 'weight',
      cmd: [script('check-weight.js')],
      sum: (o) => {
        const t = (o.match(/total JS gzip: ([\d.]+ KB)/) || [])[1];
        const e = (o.match(/initial entry gzip: ([\d.]+ KB)/) || [])[1];
        return t ? `total ${t}, entry ${e}` : lastLine(o);
      },
    },
    {
      name: 'e2e',
      cmd: [path.join(ROOT, 'e2e', 'check6.cjs')],
      env: e2eEnv(groupsArg, env),
      preview: true,
      timeoutMs: 45 * MIN,
      judge: (res) => judgeRun(res, expectedFor(groupsArg)),
    },
  ];
  if (!groupsArg) {
    e2e.push({ name: 'audit-N1', cmd: [script('audit-targets.cjs'), 'enforce'], preview: true, sum: (o) => (o.match(/elements=\d+ violations=\d+/) || [])[0] || lastLine(o) });
  }
  return { groupsArg, withE2E, fast, e2e };
}

function run(gate) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = '';
    let error;
    let settled = false;
    const child = spawn(NODE, gate.cmd, { cwd: ROOT, env: gate.env || process.env });
    const timer = setTimeout(() => {
      error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      child.kill();
    }, gate.timeoutMs || 10 * MIN);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      out = stripAnsi(out).replace(/\r/g, '');
      fs.writeFileSync(path.join(LOG_DIR, gate.name + '.log'), out);
      const res = { status, signal, error, out };
      let ok;
      let summary;
      if (gate.judge) {
        const v = gate.judge(res);
        ok = v.ok;
        summary = v.reason;
      } else {
        ok = !error && !signal && status === 0;
        summary = error ? (error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn error: ' + (error.code || error.message)) : gate.sum(out);
      }
      resolve({ name: gate.name, ok, sec: (Date.now() - t0) / 1000, out, summary });
    };
    child.on('error', (e) => {
      error = e;
      finish(null, null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function main() {
  const { withE2E, fast, e2e } = buildGates(process.argv.slice(2), process.env);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const results = [];
  for (const g of fast) results.push(await run(g));

  let preview = null;
  process.on('SIGINT', () => {
    stopPreview(preview).finally(() => process.exit(130));
  });
  if (withE2E) {
    let blocked = '';
    try {
      for (const g of e2e) {
        if (blocked) {
          results.push({ name: g.name, skip: true, sec: 0, summary: 'skipped: ' + blocked });
          continue;
        }
        if (g.preview && !preview) {
          try {
            preview = await startPreview(ROOT);
          } catch (e) {
            blocked = e.message;
            fs.writeFileSync(path.join(LOG_DIR, g.name + '.log'), e.message + '\n');
            results.push({ name: g.name, ok: false, sec: 0, out: e.message, summary: e.message });
            continue;
          }
        }
        const r = await run(g);
        results.push(r);
        if (!r.ok && g.name === 'build') blocked = 'build failed';
      }
    } finally {
      const stop = await stopPreview(preview);
      preview = null;
      if (!stop.ok) results.push({ name: 'preview-stop', ok: false, sec: 0, out: stop.reason, summary: stop.reason });
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('gate', 15) + pad('result', 8) + pad('time', 8) + 'summary');
  for (const r of results) {
    const res = r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    console.log(pad(r.name, 15) + pad(res, 8) + pad(r.sec.toFixed(1) + 's', 8) + r.summary);
  }
  const failed = results.filter((r) => !r.skip && !r.ok);
  for (const r of failed) {
    console.log(`\n--- ${r.name} (last 25 lines; full log: ${path.join(LOG_DIR, r.name + '.log')})`);
    console.log(String(r.out || '').trim().split('\n').filter(Boolean).slice(-25).join('\n'));
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\ngates: ${passed}/${results.length} passed${failed.length ? `, ${failed.length} failed` : ''}`);
  process.exit(failed.length || results.some((r) => r.skip) ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('gates FATAL', e);
    process.exit(2);
  });
}

module.exports = { buildGates };
