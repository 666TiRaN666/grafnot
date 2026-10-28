// Shared runner rules for gates.cjs and e2e-weekday-matrix.cjs (D4): a run is
// green only when the child really finished, printed the harness total and
// that total covers every check the manifest owes. Preview helpers own the
// :5199 server by PID: a busy port fails the run, stopping is bounded.
// Pure parts are covered by scripts/runner.selftest.cjs.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PREVIEW_URL = 'http://localhost:5199/';
const TOTAL_RE = /^(\d+)\/(\d+) passed$/m;

/**
 * Verdict for one finished e2e child.
 * r: { status, signal, error, out } as returned by spawn/spawnSync;
 * expected: checks the manifest owes (undefined = unknown, always red).
 */
function judgeRun(r, expected) {
  if (r.error) {
    const code = r.error.code || r.error.message;
    return { ok: false, reason: code === 'ETIMEDOUT' ? 'timeout' : 'spawn error: ' + code };
  }
  if (r.signal) return { ok: false, reason: 'killed by ' + r.signal };
  if (r.status !== 0) return { ok: false, reason: 'exit ' + r.status };
  const out = String(r.out || '').replace(/\r/g, '');
  const fails = out.split('\n').filter((l) => l.startsWith('FAIL'));
  if (fails.length > 0) return { ok: false, reason: fails.length + ' FAIL line(s)' };
  const m = out.match(TOTAL_RE);
  if (!m) return { ok: false, reason: 'no "N/M passed" total' };
  const passed = Number(m[1]);
  const total = Number(m[2]);
  if (total === 0 || passed !== total) return { ok: false, reason: `incomplete total ${passed}/${total}` };
  if (expected === undefined) return { ok: false, reason: 'no manifest total for this run' };
  if (total !== expected) return { ok: false, reason: `ran ${total} checks, manifest expects ${expected}` };
  return { ok: true, reason: `${passed}/${total} passed` };
}

/** Environment for an e2e child: GROUPS is always set explicitly, '' = full run. */
function e2eEnv(groupsArg, parentEnv) {
  return Object.assign({}, parentEnv, { GROUPS: groupsArg || '' });
}

/** Profile stores that no registry entry owns (legacy key and backups excluded). */
function findOrphans(keys, registryRaw) {
  let reg = null;
  try { reg = JSON.parse(registryRaw || 'null'); } catch { reg = null; }
  const ids = new Set(((reg && reg.profiles) || []).map((p) => p.id));
  return keys.filter((k) => {
    if (k === 'grafnot-store-v2' || !k.startsWith('grafnot-store-')) return false;
    if (k.includes(':corrupt-')) return false; // timestamped backups, not stores
    return !ids.has(k.slice('grafnot-store-'.length));
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url || PREVIEW_URL, (res) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start our own preview from dist/; a server already on :5199 is an error (stale builds fake results). */
async function startPreview(root) {
  if (await httpOk()) throw new Error(':5199 is already served — stop that server first (a stale build fakes e2e results)');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--port', '5199', '--strictPort'], { cwd: root, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });
  for (let i = 0; i < 60 && !exited; i++) {
    if (await httpOk()) return child;
    await sleep(500);
  }
  await stopPreview(child);
  throw new Error(exited ? 'preview exited before answering on :5199' : 'preview did not answer on :5199 within 30 s');
}

/** Stop a preview we started: kill by handle, wait for exit and a free port, bounded to ~10 s. */
async function stopPreview(child) {
  if (!child) return { ok: true, reason: 'not started' };
  if (child.exitCode === null && child.signalCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill();
    await Promise.race([gone, sleep(5000)]);
  }
  for (let i = 0; i < 10; i++) {
    if (!(await httpOk())) return { ok: true, reason: 'stopped' };
    await sleep(500);
  }
  return { ok: false, reason: `preview pid ${child.pid} still answers on :5199` };
}

module.exports = { PREVIEW_URL, judgeRun, e2eEnv, findOrphans, httpOk, startPreview, stopPreview };
