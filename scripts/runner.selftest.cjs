// Self-test for the e2e runners (D4): a run may be green only when the child
// really finished and reported every check it owed. Real child processes are
// spawned for the crash/timeout/spawn-error cases, so the verdict is tested
// against what spawnSync actually returns on this OS.
// Run: node scripts/runner.selftest.cjs
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { judgeRun, e2eEnv, findOrphans } = require('./runner-lib.cjs');
const { EXPECTED_CHECKS, GROUP_SIZES, expectedFor } = require('../e2e/manifest.cjs');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push('PASS ' + name);
  } catch (e) {
    results.push('FAIL ' + name + ': ' + String((e && e.message) || e).split('\n')[0]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// Run a tiny node child and hand its spawnSync result to the verdict.
function child(code, opts) {
  const r = spawnSync(process.execPath, ['-e', code], Object.assign({ encoding: 'utf8' }, opts || {}));
  return { status: r.status, signal: r.signal, error: r.error, out: (r.stdout || '') + '\n' + (r.stderr || '') };
}
const printTotal = (p, t) => `console.log('PASS a\\nPASS b\\n\\n${p}/${t} passed')`;

check('positive control: finished run with full total is green', () => {
  const v = judgeRun(child(printTotal(2, 2)), 2);
  assert(v.ok, 'green run judged red: ' + v.reason);
});
check('crash (uncaught throw) is red', () => {
  const v = judgeRun(child("throw new Error('boom')"), 2);
  assert(!v.ok, 'crash judged green');
});
check('exit 0 without a total is red', () => {
  const v = judgeRun(child("console.log('PASS a')"), 2);
  assert(!v.ok, 'missing total judged green');
});
check('incomplete total is red', () => {
  const v = judgeRun(child(printTotal(1, 2)), 2);
  assert(!v.ok, 'incomplete total judged green');
});
check('total below the manifest is red', () => {
  const v = judgeRun(child(printTotal(13, 13)), 14);
  assert(!v.ok, '13 of 14 expected checks judged green');
});
check('non-zero exit is red even with a full total', () => {
  const v = judgeRun(child(printTotal(2, 2) + '; process.exit(1)'), 2);
  assert(!v.ok, 'exit 1 judged green');
});
check('timeout is red', () => {
  const v = judgeRun(child('setTimeout(() => {}, 10000)', { timeout: 300 }), 2);
  assert(!v.ok, 'timed-out child judged green');
});
check('spawn error is red', () => {
  const r = spawnSync('grafnot-no-such-binary-' + process.pid, [], { encoding: 'utf8' });
  const v = judgeRun({ status: r.status, signal: r.signal, error: r.error, out: '' }, 2);
  assert(!v.ok, 'spawn error judged green');
});
check('killed child is red', () => {
  const v = judgeRun({ status: null, signal: 'SIGKILL', error: undefined, out: '' }, 2);
  assert(!v.ok, 'signal judged green');
});
check('full gates run clears an inherited GROUPS', () => {
  const env = e2eEnv('', { GROUPS: 'G1-adopt-clean', PATH: 'x' });
  assert(env.GROUPS === '', 'full run inherits GROUPS=' + env.GROUPS);
  assert(env.PATH === 'x', 'parent env dropped');
});
check('subset gates run passes only its own groups', () => {
  const env = e2eEnv('G20-plan,G21-week', { GROUPS: 'G1-adopt-clean' });
  assert(env.GROUPS === 'G20-plan,G21-week', 'subset GROUPS=' + env.GROUPS);
});
check('gates wires the e2e gate through e2eEnv', () => {
  const src = fs.readFileSync(path.join(__dirname, 'gates.cjs'), 'utf8');
  assert(src.includes('require.main === module'), 'gates.cjs runs on require: no buildGates() to inspect');
  const { buildGates } = require('./gates.cjs');
  const gate = buildGates([], { GROUPS: 'G1-adopt-clean' }).e2e.find((g) => g.name === 'e2e');
  assert(gate && gate.env && gate.env.GROUPS === '', 'full gates e2e env GROUPS=' + (gate && gate.env && gate.env.GROUPS));
});
check('manifest: full and subset totals', () => {
  assert(expectedFor('') === EXPECTED_CHECKS, 'full total');
  assert(expectedFor('G20-plan,G21-week') === 13, 'subset total ' + expectedFor('G20-plan,G21-week'));
  assert(expectedFor('G99-nope') === undefined, 'unknown group must have no total');
});
check('full run order covers the manifest exactly', () => {
  // Parsed, not required: requiring e2e/check6.cjs would start the suite.
  const src = fs.readFileSync(path.join(__dirname, '..', 'e2e', 'check6.cjs'), 'utf8');
  const order = (src.match(/'(G\d+-[A-Za-z0-9-]+)'/g) || []).map((s) => s.slice(1, -1));
  const names = Object.keys(GROUP_SIZES);
  const missing = names.filter((g) => !order.includes(g));
  const extra = order.filter((g) => !names.includes(g));
  const dup = order.filter((g, i) => order.indexOf(g) !== i);
  assert(!missing.length && !extra.length && !dup.length, `missing=${missing} extra=${extra} dup=${dup}`);
  assert(Object.values(GROUP_SIZES).reduce((a, b) => a + b, 0) === EXPECTED_CHECKS, 'GROUP_SIZES sum differs from EXPECTED_CHECKS');
});
check('orphans: unowned store found, legacy and backups ignored', () => {
  const reg = JSON.stringify({ profiles: [{ id: 'p1' }], activeId: 'p1' });
  const keys = ['grafnot-store-p1', 'grafnot-store-p2', 'grafnot-store-v2', 'grafnot-store-p1:corrupt-123', 'grafnot-theme:p1'];
  const o = findOrphans(keys, reg);
  assert(o.length === 1 && o[0] === 'grafnot-store-p2', 'orphans=' + o.join(','));
});
check('orphans: unreadable registry owns nothing', () => {
  const o = findOrphans(['grafnot-store-p1'], '{broken');
  assert(o.length === 1, 'orphans=' + o.join(','));
});

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(results.join('\n'));
console.log(`\nrunner selftest: ${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
