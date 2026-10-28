// All gates in one command with a short summary; full output only for failures.
// Usage: npm run gates                      — unit, tsc, oxlint, i18n (+selftest), contrast, README sync
//        npm run gates -- --e2e             — + build, weight, preview :5199, full e2e, N1 audit enforce
//        npm run gates -- --groups=G20-plan,G21-week — + build, weight, preview, these e2e groups only
// The preview server is started and stopped here (by its own PID); a busy :5199
// fails the run instead of testing against a stale server.
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(os.tmpdir(), 'grafnot-gates');
const PREVIEW_URL = 'http://localhost:5199/';
const NODE = process.execPath;
const bin = (...p) => path.join(ROOT, 'node_modules', ...p);
const script = (name) => path.join(ROOT, 'scripts', name);

const args = process.argv.slice(2);
const groupsArg = (args.find((a) => a.startsWith('--groups=')) || '').slice('--groups='.length);
const withE2E = args.includes('--e2e') || groupsArg !== '';

const ESC = String.fromCharCode(27);
const stripAnsi = (s) => s.split(ESC).map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, ''))).join('');
const lastLine = (out) => out.trim().split('\n').filter(Boolean).pop() || '';
const count = (out, re) => (out.match(re) || []).length;

const FAST = [
  { name: 'unit', cmd: [bin('vitest', 'vitest.mjs'), 'run'], sum: (o) => (o.match(/Tests\s+(.+)/) || [])[1] || lastLine(o) },
  { name: 'tsc', cmd: [bin('typescript', 'bin', 'tsc'), '-b'], sum: (o) => (o.trim() ? lastLine(o) : '0 errors') },
  { name: 'oxlint', cmd: [bin('oxlint', 'bin', 'oxlint')], sum: (o) => `${count(o, / error /g)} errors, ${count(o, / warning /g)} warnings` },
  { name: 'i18n', cmd: [script('check-i18n.js')], sum: lastLine },
  { name: 'i18n-selftest', cmd: [script('check-i18n.selftest.js')], sum: lastLine },
  { name: 'contrast', cmd: [script('check-contrast.cjs')], sum: lastLine },
  { name: 'readme', cmd: [script('sync-readme.js')], sum: lastLine },
];
const E2E = [
  { name: 'build', cmd: [bin('vite', 'bin', 'vite.js'), 'build'], sum: (o) => (o.match(/built in \S+/) || [])[0] || lastLine(o) },
  {
    name: 'weight',
    cmd: [script('check-weight.js')],
    sum: (o) => {
      const t = (o.match(/total JS gzip: ([\d.]+ KB)/) || [])[1];
      const e = (o.match(/initial entry gzip: ([\d.]+ KB)/) || [])[1];
      return t ? `total ${t}, entry ${e}` : lastLine(o);
    },
  },
  { name: 'e2e', cmd: [path.join(ROOT, 'e2e', 'check6.cjs')], env: groupsArg ? { GROUPS: groupsArg } : {}, preview: true, sum: (o) => (o.match(/(\d+\/\d+ passed)/) || [])[1] || lastLine(o) },
];
if (!groupsArg) {
  E2E.push({ name: 'audit-N1', cmd: [script('audit-targets.cjs'), 'enforce'], preview: true, sum: (o) => (o.match(/elements=\d+ violations=\d+/) || [])[0] || lastLine(o) });
}

function run(gate) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(NODE, gate.cmd, { cwd: ROOT, env: Object.assign({}, process.env, gate.env || {}) });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      out = stripAnsi(out).replace(/\r/g, '');
      fs.writeFileSync(path.join(LOG_DIR, gate.name + '.log'), out);
      resolve({ name: gate.name, ok: code === 0, sec: (Date.now() - t0) / 1000, out, summary: gate.sum(out) });
    });
  });
}

function httpOk() {
  return new Promise((resolve) => {
    const req = http.get(PREVIEW_URL, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startPreview() {
  if (await httpOk()) throw new Error(':5199 is already served — stop that server first (a stale build fakes e2e results)');
  const child = spawn(NODE, [bin('vite', 'bin', 'vite.js'), 'preview', '--port', '5199', '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    if (await httpOk()) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error('preview did not answer on :5199 within 30 s');
}

(async () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const results = [];
  for (const g of FAST) results.push(await run(g));

  let preview = null;
  const stop = () => {
    if (preview) preview.kill();
    preview = null;
  };
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  if (withE2E) {
    let blocked = '';
    try {
      for (const g of E2E) {
        if (blocked) {
          results.push({ name: g.name, skip: true, sec: 0, summary: 'skipped: ' + blocked });
          continue;
        }
        if (g.preview && !preview) {
          try {
            preview = await startPreview();
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
      stop();
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
    console.log(r.out.trim().split('\n').filter(Boolean).slice(-25).join('\n'));
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\ngates: ${passed}/${results.length} passed${failed.length ? `, ${failed.length} failed` : ''}`);
  process.exit(failed.length || results.some((r) => r.skip) ? 1 : 0);
})().catch((e) => {
  console.error('gates FATAL', e);
  process.exit(2);
});
