// E2E harness: config, seeds, helpers and the runner. Groups live in
// e2e/groups/<name>.cjs and receive the API below plus page/browser/ctx.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:5199/';
// P5': portable resolver (Windows default vs Ubuntu google-chrome).
const EXE = require('../scripts/chrome-exe.cjs');
// Check counts live in the manifest so the runners can re-check our total (D4).
const { EXPECTED_CHECKS, GROUP_SIZES, parseGroups } = require('./manifest.cjs');
const { findOrphans } = require('../scripts/runner-lib.cjs');

// Mirror of MAP_UNLOCK in src/App.tsx: gate counts derive from it, never magic numbers.
const MAP_UNLOCK = 20;

// P5': opt-in Playwright tracing for CI artifacts. Off by default (zero
// overhead); CI sets E2E_TRACE=1. Records always, SAVES only on failure.
const TRACE_DIR = path.join(process.env.RUNNER_TEMP || require('os').tmpdir(), 'grafnot-e2e-artifacts');

function assertExe() {
  if (!fs.existsSync(EXE)) {
    console.error('E2E misconfigured: Chrome not found at ' + EXE + ' — set CHROME_PATH env to your browser binary');
    process.exit(2);
  }
}

// Fail fast with a readable message when the preview server is down instead
// of a cryptic browser launch/navigation error deep in the suite.
async function fetchRoot() {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
}
function assetNames(html) {
  const out = [];
  const re = /\/assets\/index-[^"'?#]+\.js/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[0]);
  return out.sort();
}
async function precheckPreview() {
  const got = await fetchRoot();
  if (!got) {
    console.error('E2E precheck failed: nothing serves ' + URL + ' — start it first: node node_modules/vite/bin/vite.js preview --port 5199');
    process.exit(2);
  }
  if (got.status !== 200) {
    console.error('E2E precheck failed: ' + URL + ' answered HTTP ' + got.status + ' (want 200)');
    process.exit(2);
  }
  const distHtml = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(distHtml)) {
    console.error('E2E precheck failed: no dist/index.html — run npm run build first');
    process.exit(2);
  }
  const served = assetNames(got.body);
  const built = assetNames(fs.readFileSync(distHtml, 'utf8'));
  if (served.join('\n') !== built.join('\n')) {
    console.error('E2E precheck failed: preview serves a stale build (served assets differ from dist/index.html) — rebuild (npm run build) and restart preview');
    process.exit(2);
  }
}

const results = [];
let tailFailure = '';
let endNote = '';
function setTailFailure(msg) {
  tailFailure = tailFailure ? tailFailure + '; ' + msg : msg;
}
const runtimeErrors = [];
// Substrings of page errors known to be caused by tests on purpose.
// Add only with a comment why.
const ERROR_ALLOWLIST = [
  // Stage-05 P30 tests crash chunks on purpose; the boundary logs them.
  'grafnot-boundary:',
  // Aborted NotesView chunk request from the P30 test (hash changes per build).
  'requestfailed: http://localhost:5199/assets/NotesView-',
  // Chromium's console report of that same aborted request.
  'Failed to load resource: net::ERR_FAILED',
  // React's own log of the caught abort (checks still assert the editor).
  'Failed to fetch dynamically imported module',
  // React's own log of the caught P30 throw probe (exact test string).
  'chunk-crash-probe',
];
function attachErrorGuards(pg) {
  pg.on('pageerror', (e) => runtimeErrors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
  pg.on('console', (msg) => {
    if (msg.type() === 'error') runtimeErrors.push('console.error: ' + msg.text());
  });
  pg.on('requestfailed', (req) => {
    if (req.url().endsWith('.js')) runtimeErrors.push('requestfailed: ' + req.url());
  });
}
function runtimeAllowed(text) {
  return ERROR_ALLOWLIST.some((s) => text.includes(s));
}

// ---------- Group seeds and selective runs (STAGE 02) ----------
// GROUPS env: comma-separated group names to run only (e.g. GROUPS=G4-story).
// Empty = full run. Needed by stage 11 for repeat runs of affected groups.
const GROUP_FILTER = parseGroups(process.env.GROUPS);
let currentGroup = '';
let mainPage = null;
// P5': hoisted tracing handle (see finally note).
let traceCtx = null;
function assertGroupSizes() {
  const sized = Object.values(GROUP_SIZES).reduce((a, b) => a + b, 0);
  if (sized !== EXPECTED_CHECKS) {
    console.error(`E2E misconfigured: GROUP_SIZES sum is ${sized}, want EXPECTED_CHECKS=${EXPECTED_CHECKS}`);
    process.exit(2);
  }
  const known = Object.keys(GROUP_SIZES);
  const unknown = GROUP_FILTER.filter((g) => !known.includes(g));
  if (unknown.length > 0) {
    console.error('E2E misconfigured: unknown GROUPS: ' + unknown.join(',') + ' — known: ' + known.join(','));
    process.exit(2);
  }
}
// Build a seed in the REAL storage layout: registry + per-profile stores + prefs.
// stores values: store object or raw string (raw allows seeding corrupt JSON).
// profiles accepts a raw string too (seeding a broken registry for G16).
// prefs keys: full key names (e.g. 'grafnot-list-limits:p1').
function seedProfiles({ profiles, activeId, stores, prefs }) {
  const seed = { 'grafnot-profiles-v1': typeof profiles === 'string' ? profiles : JSON.stringify({ profiles, activeId }) };
  for (const id of Object.keys(stores)) {
    const st = stores[id];
    seed['grafnot-store-' + id] = typeof st === 'string' ? st : JSON.stringify(st);
  }
  for (const k of Object.keys(prefs || {})) {
    const v = prefs[k];
    seed[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return seed;
}
// Legacy single-key layout (adoption path). Accepts a raw string for corrupt JSON.
function seedLegacy(store) {
  return { 'grafnot-store-v2': typeof store === 'string' ? store : JSON.stringify(store) };
}
// Mirror of SCHEMA_VERSION in src/store.ts: v5store seeds a CURRENT-schema
// store (name kept from v5); migration paths seed older versions explicitly.
const CURRENT_SCHEMA = 6;
function v5store(notes, activeId, extra) {
  return Object.assign(
    { schemaVersion: CURRENT_SCHEMA, notes, tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId },
    extra || {},
  );
}
function seedNote(id, title, extra) {
  return Object.assign({ id, title, content: '', text: '', linkedIds: [], calcs: [], updated: 1 }, extra || {});
}
// G4-story entry: two unlinked notes (lock toast fires on nav-map).
function storyEntryNotes() {
  return [
    { id: 'a1', title: 'Alpha', content: '', text: '', linkedIds: [], calcs: [], updated: 1 },
    { id: 'b1', title: 'Beta', content: '', text: '', linkedIds: [], calcs: [], updated: 2 },
  ];
}
// G4-story growth (old P7 seed-builder output, built in Node from known state):
// Seed 2..Seed 20, HCI graph over all notes. Applied as legacy to keep adoption.
function storyGrownLegacy() {
  const notes = storyEntryNotes();
  for (let i = 2; i <= MAP_UNLOCK; i++) {
    notes.push({ id: 'seed' + i, title: 'Seed ' + i, notebook: 'HCI', content: '', text: '', linked: [], calcs: [] });
  }
  return seedLegacy({
    schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [],
    graphs: [{ id: 'gseed', title: 'HCI', noteIds: notes.map((n) => n.id) }],
    prompts: [], customTpls: [], activeId: 'b1',
  });
}
// Runs before app code on EVERY page load in contexts registered below.
// Applies a pending seed (full wipe + apply), so the previous instance's
// unload-flush cannot pollute the seeded keys: its writes get wiped.
function applySeedNext() {
  try {
    const raw = window.localStorage.getItem('grafnot-seed-next');
    if (!raw) return;
    // T2: date markers resolve INSIDE the page (page clock + pinned zone):
    // "@today+N" = page-local today + N days, "@mon+N" = Monday of the
    // displayed week + N days. Arithmetic is local-date based (getDay()+6)%7.
    // Seeds nest JSON (store JSON inside seed JSON), so markers arrive
    // backslash-escaped (\"@today-1\"): match the escapes, keep them.
    // Proven: init scripts run with REAL time even under a frozen clock, so
    // in frozen mode (grafnot-seed-frozen flag) expansion is DEFERRED to the
    // post-load pass in reseed(), which runs under the frozen clock.
    const frozen = window.localStorage.getItem('grafnot-seed-frozen');
    try {
      window.localStorage.removeItem('grafnot-seed-frozen');
    } catch { /* keep going: flag is best-effort */ }
    const expanded = frozen ? raw : raw.replace(/\\?"@((?:today)|(?:mon))([+-]\d+)\\?"/g, (m, base, off) => {
      const d = new Date();
      if (base === 'mon') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      d.setDate(d.getDate() + parseInt(off, 10));
      const p = (x) => String(x).padStart(2, '0');
      const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      return m[0] === '\\' ? `\\"${iso}\\"` : `"${iso}"`;
    });
    const seed = JSON.parse(expanded);
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('grafnot-')) window.localStorage.removeItem(k);
    }
    for (const k of Object.keys(seed)) window.localStorage.setItem(k, seed[k]);
    window.localStorage.removeItem('grafnot-seed-next');
  } catch (e) {
    try {
      window.localStorage.setItem('grafnot-seed-error', String((e && e.message) || e));
    } catch { /* quota: reseed() below still fails loudly on stale keys */ }
  }
}
// Seed BEFORE app launch: stage the seed, drop any deep-link hash (reload
// preserves it, and every check navigates explicitly), reload, init script
// applies the seed.
// T2 fixed-clock second pass: init scripts run before the frozen clock
// applies on reload, so markers expanded with real time (or not at all).
// Rewrite any surviving markers with the CURRENT page time (frozen when
// E2E_FIXED_CLOCK is set) and reboot once so the app reads final values.
// Live runs have no markers left: no-op, no extra reload.
function expandStoredMarkers() {
  const re = /\\?"@((?:today)|(?:mon))([+-]\d+)\\?"/g;
  const sub = (m, base, off) => {
    const d = new Date();
    if (base === 'mon') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setDate(d.getDate() + parseInt(off, 10));
    const p = (x) => String(x).padStart(2, '0');
    const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return m[0] === '\\' ? `\\"${iso}\\"` : `"${iso}"`;
  };
  let changed = false;
  for (const k of Object.keys(window.localStorage)) {
    if (k.indexOf('grafnot-store-') !== 0) continue;
    const v = window.localStorage.getItem(k);
    if (!v || v.indexOf('"@') === -1) continue;
    window.localStorage.setItem(k, v.replace(re, sub));
    changed = true;
  }
  return changed;
}
async function reseed(pg, seed) {
  await pg.evaluate((s) => window.localStorage.setItem('grafnot-seed-next', JSON.stringify(s)), seed);
  // T2: arm frozen-mode marker deferral (see applySeedNext).
  await pg.evaluate((frozen) => {
    if (frozen) window.localStorage.setItem('grafnot-seed-frozen', '1');
  }, !!process.env.E2E_FIXED_CLOCK);
  await pg.evaluate(() => {
    window.location.hash = '';
  });
  await pg.reload({ waitUntil: 'networkidle' });
  const err = await pg.evaluate(() => window.localStorage.getItem('grafnot-seed-error'));
  if (err) throw new Error('seed apply failed: ' + err);
  if (await pg.evaluate(expandStoredMarkers)) {
    await pg.reload({ waitUntil: 'networkidle' });
  }
}
async function resetStorage(pg) {
  await pg.evaluate(() => {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('grafnot-')) window.localStorage.removeItem(k);
    }
    // Same stale-hash reason as reseed(): reload keeps the fragment.
    window.location.hash = '';
  });
}
// Every group starts with this: sets currentGroup (for GROUPS filter)
// and reseeds the main page. check() skips execution for filtered-out groups.
async function beginGroup(name, seed) {
  currentGroup = name;
  if (GROUP_FILTER.length > 0 && !GROUP_FILTER.includes(name)) return;
  await reseed(mainPage, seed);
}
// True when the group must execute (sets currentGroup for check() filtering).
async function groupActive(name) {
  currentGroup = name;
  return GROUP_FILTER.length === 0 || GROUP_FILTER.includes(name);
}
// Quota stub for G17-adoption (runs on every page load, armed only by a
// 'grafnot-quota-stub' seed flag). Wraps once; every call re-checks the flag
// so later groups without it pass through untouched. Profile-store and
// registry writes throw a real QuotaExceededError; the legacy original, the
// seed plumbing and the flag itself stay writable.
function quotaStubNext() {
  try {
    const proto = Storage.prototype;
    if (proto.setItem.__quotaWrapped) return;
    const orig = proto.setItem;
    const wrapped = function (k, v) {
      let armed = false;
      try {
        armed = !!window.localStorage.getItem('grafnot-quota-stub');
      } catch { armed = false; }
      if (armed) {
        const key = String(k);
        if (key === 'grafnot-profiles-v1' || (key.startsWith('grafnot-store-') && key !== 'grafnot-store-v2')) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
      }
      return orig.call(this, k, v);
    };
    wrapped.__quotaWrapped = true;
    proto.setItem = wrapped;
  } catch { /* storage unavailable: stay inert */ }
}
// Second tab on the SAME context = shared localStorage (stage 07 two-tab tests).
async function openSecondTab(ctx) {
  const p = await ctx.newPage();
  attachErrorGuards(p);
  return p;
}
// storageState for isolated mobile contexts: seeds storage before first load,
// so no live-app seeding is needed there at all.
function storageStateFor(seed) {
  return {
    cookies: [],
    origins: [{
      origin: 'http://localhost:5199',
      localStorage: Object.entries(seed).map(([name, value]) => ({ name, value })),
    }],
  };
}

async function check(name, fn) {
  if (GROUP_FILTER.length > 0 && !GROUP_FILTER.includes(currentGroup)) return;
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    const location = String(e.stack || '').split('\n').find((line) => line.includes(path.sep + 'groups' + path.sep));
    results.push(`FAIL ${name}: ${String(e.message || e).split('\n')[0]} ${location || ''}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// Profile stores in the page's storage that no registry entry owns.
async function orphanStores(pg) {
  const snap = await pg.evaluate(() => ({
    keys: Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-')),
    registry: window.localStorage.getItem('grafnot-profiles-v1'),
  }));
  if (process.env.VERBOSE) console.log('storage keys: ' + JSON.stringify(snap.keys));
  return { stores: snap.keys.filter((k) => k.startsWith('grafnot-store-')).length, orphans: findOrphans(snap.keys, snap.registry) };
}
// S2 shell helpers: new notes and cross-entity jumps go through Quick Add.
// Palette picks remount the editor: always wait for the hash move plus the
// freshly mounted title before typing, never for a merely attached input.
async function newViaPalette(pg) {
  const before = await pg.evaluate(() => window.location.hash);
  await pg.getByTestId('quickadd').click();
  await pg.getByTestId('palette').waitFor();
  await pg.getByTestId('palette').getByRole('button', { name: '+ Новая заметка' }).click();
  await pg.waitForFunction((prev) => window.location.hash !== prev && window.location.hash.indexOf('#/notes/') === 0, before, { timeout: 8000 });
  // Attached only: the editor remounts on navigation, and Playwright fills
  // re-resolve the selector, so typing below always lands in the new note
  // (its title may carry a uniqueness suffix, never assume the default).
  await pg.locator('.g-title-in').waitFor();
}
async function pickViaPalette(pg, text, expectTitle) {
  await pg.keyboard.press('Control+k');
  await pg.getByTestId('palette-input').fill(text);
  await pg.locator('[data-testid^="palette-item-"]', { hasText: text }).first().click();
  if (expectTitle !== undefined) {
    await pg.waitForFunction((t) => (document.querySelector('.g-title-in') || {}).value === t, expectTitle, { timeout: 8000 });
  }
}

async function run(groupNames) {
  await precheckPreview();
  assertExe();
  assertGroupSizes();
  const browser = await chromium.launch({ executablePath: EXE });
  try {
  // T2: pinned zone for calendar independence (seeds and app dates resolve
  // inside the page under this zone; Node-side TZ no longer matters).
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Almaty', locale: 'ru-RU' });
  if (process.env.E2E_TRACE) await ctx.tracing.start({ screenshots: true, snapshots: true });
  traceCtx = ctx;
  await ctx.addInitScript(applySeedNext);
  await ctx.addInitScript(quotaStubNext);
  const page = await ctx.newPage();
  mainPage = page;
  attachErrorGuards(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  // T2: E2E_FIXED_CLOCK=ISO freezes the page clock (weekday matrix). Applied
  // once: the clock survives reloads, and seed markers expand under it.
  if (process.env.E2E_FIXED_CLOCK) {
    const at = new Date(process.env.E2E_FIXED_CLOCK);
    if (Number.isNaN(at.getTime())) {
      console.error('E2E misconfigured: bad E2E_FIXED_CLOCK=' + process.env.E2E_FIXED_CLOCK);
      process.exit(2);
    }
    await page.clock.setFixedTime(at);
  }

  const api = Object.assign({}, API, { page, browser, ctx });
  for (const name of groupNames) {
    await require(path.join(__dirname, 'groups', name + '.cjs'))(api);
  }
  // D4: the full-run orphan check belongs to the real end of the suite, after
  // the last group (filtered runs end mid-state on purpose and skip it).
  if (GROUP_FILTER.length === 0) {
    const end = await orphanStores(page);
    if (end.orphans.length > 0) setTailFailure('orphan profile stores left at end of run: ' + end.orphans.join(','));
    else endNote = `end-of-run orphan check: ${end.stores} store key(s), none orphaned`;
  }

  } finally {
    // P5': save the trace only when something failed (main context only;
    // isolated mobile/error contexts are short-lived by design).
    // NOTE: the context is reached via module-scope traceCtx, not the
    // try-block const: empirically the finally does not see try-block
    // bindings here (see P5' report), so the reference is hoisted.
    if (process.env.E2E_TRACE && traceCtx) {
      if (results.some((r) => r.startsWith('FAIL'))) {
        fs.mkdirSync(TRACE_DIR, { recursive: true });
        const tracePath = path.join(TRACE_DIR, 'trace.zip');
        await traceCtx.tracing.stop({ path: tracePath });
        console.log('trace: ' + tracePath);
      } else {
        await traceCtx.tracing.stop();
      }
    }
    await browser.close();
  }
  if (tailFailure) {
    console.log(results.join('\n'));
    console.error('\nFAIL ' + tailFailure);
    process.exit(1);
  }
  const unexpected = runtimeErrors.filter((t) => !runtimeAllowed(t));
  if (unexpected.length > 0) {
    console.log(results.join('\n'));
    console.error(`\nFAIL runtime errors (${unexpected.length}):`);
    unexpected.slice(0, 5).forEach((t) => console.error(' - ' + t));
    process.exit(1);
  }
  const expectedChecks = GROUP_FILTER.length > 0
    ? GROUP_FILTER.reduce((n, g) => n + (GROUP_SIZES[g] || 0), 0)
    : EXPECTED_CHECKS;
  if (GROUP_FILTER.length > 0 && results.length === 0) {
    console.error('FAIL GROUPS matched no executed checks — filter skipped everything');
    process.exit(1);
  }
  if (results.length !== expectedChecks) {
    console.log(results.join('\n'));
    console.error(`\nFAIL expected ${expectedChecks} checks, got ${results.length} — update EXPECTED_CHECKS (and GROUP_SIZES) when adding checks`);
    process.exit(1);
  }
  console.log(results.join('\n'));
  if (endNote) console.log(endNote);
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
}

const API = {
  URL,
  MAP_UNLOCK,
  GROUP_FILTER,
  setTailFailure,
  attachErrorGuards,
  seedProfiles,
  seedLegacy,
  v5store,
  seedNote,
  storyEntryNotes,
  storyGrownLegacy,
  reseed,
  resetStorage,
  beginGroup,
  groupActive,
  openSecondTab,
  storageStateFor,
  check,
  assert,
  orphanStores,
  newViaPalette,
  pickViaPalette,
};

module.exports = { run };
