const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:5199/';
const EXE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// How many checks run below. Update together when adding checks.
const EXPECTED_CHECKS = 81;

// Mirror of MAP_UNLOCK in src/App.tsx: gate counts derive from it, never magic numbers.
const MAP_UNLOCK = 20;

function assertExe() {
  if (!fs.existsSync(EXE)) {
    console.error('E2E misconfigured: Chrome not found at ' + EXE + ' — set CHROME_PATH env to your chrome.exe');
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
const runtimeErrors = [];
// Substrings of page errors known to be caused by tests on purpose.
// Add only with a comment why.
const ERROR_ALLOWLIST = [
  // Stage-05 P30 tests crash chunks on purpose; the boundary logs them.
  'grafnot-boundary:',
  // Aborted HomePage chunk request from the P30 test (hash changes per build).
  'requestfailed: http://localhost:5199/assets/HomePage-',
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
const GROUP_FILTER = (process.env.GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);
let currentGroup = '';
let mainPage = null;
// Per-group check counts. Update together with EXPECTED_CHECKS when adding checks.
const GROUP_SIZES = {
  'G0-boot': 3, 'G1-adopt-clean': 1, 'G2-editor': 9, 'G3-linkcalc': 6,
  'G4-story': 20, 'G5-prompt': 6, 'G6-tasks': 7, 'G7-lists': 3,
  'G8-mobile': 1, 'G9-profiles': 5, 'G10-p27': 5, 'G11-selftest': 1, 'G12-blocked': 3, 'G13-error': 2, 'G14-savefail': 2, 'G15-twotab': 2, 'G16-registry': 2, 'G17-adoption': 3,
};
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
function v5store(notes, activeId, extra) {
  return Object.assign(
    { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId },
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
    const seed = JSON.parse(raw);
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
// Seed BEFORE app launch: stage the seed, reload, init script applies it.
async function reseed(pg, seed) {
  await pg.evaluate((s) => window.localStorage.setItem('grafnot-seed-next', JSON.stringify(s)), seed);
  await pg.reload({ waitUntil: 'networkidle' });
  const err = await pg.evaluate(() => window.localStorage.getItem('grafnot-seed-error'));
  if (err) throw new Error('seed apply failed: ' + err);
}
async function resetStorage(pg) {
  await pg.evaluate(() => {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('grafnot-')) window.localStorage.removeItem(k);
    }
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
    const location = String(e.stack || '').split('\n').find((line) => line.includes('check6.cjs'));
    results.push(`FAIL ${name}: ${String(e.message || e).split('\n')[0]} ${location || ''}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  await precheckPreview();
  assertExe();
  assertGroupSizes();
  const browser = await chromium.launch({ executablePath: EXE });
  try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(applySeedNext);
  await ctx.addInitScript(quotaStubNext);
  const page = await ctx.newPage();
  mainPage = page;
  attachErrorGuards(page);
  await page.goto(URL, { waitUntil: 'networkidle' });

  // ---------- GROUP G0-boot: first run, empty storage ----------
  await beginGroup('G0-boot', {});
  // ---------- P5: empty start ----------
  await check('P5 empty home', async () => {
    await page.locator('.g-empty-t').waitFor();
    const t = await page.locator('.g-empty').innerText();
    assert(t.includes('Пока пусто'), 'no empty title');
  });
  await check('P5 empty search', async () => {
    await page.keyboard.press('Control+k');
    await page.locator('.g-search').waitFor();
    const t = await page.locator('.g-results').innerText();
    assert(t.includes('Ничего не найдено'), 'search not empty');
    await page.keyboard.press('Escape');
  });
  await check('P5 first note + hint once', async () => {
    await page.locator('.g-empty button').click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('.g-hint').waitFor();
    await page.locator('.g-hint button').click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-hint').count()) === 0, 'hint shown again');
  });

  // ---------- GROUP G1-adopt-clean: legacy adoption drops broken links ----------
  await beginGroup('G1-adopt-clean', seedLegacy({
    notes: [{ id: 'o1', title: 'Old', content: '', text: '', linked: ['Ghost'] }],
    tasks: [],
    activeId: 'o1',
  }));

  // ---------- P6: tiptap + cursor ----------

  await check('P5b migration drops broken links', async () => {
    await page.locator('.g-toasts').waitFor();
    assert((await page.locator('.g-toasts').innerText()).includes('Удалено битых ссылок'), 'no cleanup toast');
    await page.locator('.g-title-in').waitFor();
  });

  // ---------- GROUP G2-editor: editor, tasks, calendar (one empty note) ----------
  await beginGroup('G2-editor', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('n1', 'Old')], 'n1') },
  }));

  await check('P6 cursor order Hi', async () => {
    const ed = page.locator('.tiptap');
    await ed.click();
    await page.keyboard.type('H');
    await page.keyboard.type('i');
    const txt = await ed.innerText();
    assert(txt.includes('Hi'), `order broken, got: ${txt}`);
    const off = await page.evaluate(() => window.getSelection()?.anchorOffset ?? -1);
    assert(off === 2, `caret offset ${off}, want 2`);
  });
  await check('P6 bold + undo', async () => {
    await page.keyboard.press('Control+a');
    await page.getByTitle('Bold').click();
    const html = await page.locator('.tiptap').innerHTML();
    assert(html.includes('<strong>'), 'no bold applied');
    await page.getByTitle('Undo').click();
    const html2 = await page.locator('.tiptap').innerHTML();
    assert(!html2.includes('<strong>'), 'undo did not revert');
  });
  await check('P6 title Alpha', async () => {
    await page.locator('.g-title-in').fill('Alpha');
  });

  // ---------- P1: tasks separate + noteId ----------
  await check('P1 task dialog prefilled', async () => {
    await page.locator('.tiptap p').click();
    await page.waitForFunction(() => !!document.activeElement?.classList?.contains('tiptap'), null, { timeout: 8000 });
    await page.keyboard.press('Control+a');
    await page.getByTitle('+ Задача').click();
    await page.locator('.g-modal').waitFor();
    assert((await page.locator('.g-modal .g-in').inputValue()) === 'Hi', 'dialog not prefilled');
    await page.locator('.g-modal .g-area').fill('mydesc');
    await page.locator('.g-modal .g-btn.primary').click();
    await page.locator('.g-note-tasks').waitFor();
    assert((await page.locator('.g-note-tasks').innerText()).includes('(1)'), 'no count in note');
  });
  await check('P1b edit task desc', async () => {
    await page.locator('.g-note-tasks').getByRole('button', { name: 'Изменить' }).click();
    await page.locator('.g-modal .g-area').fill('mydesc2');
    await page.locator('.g-modal .g-btn.primary').click();
    await page.getByTestId('nav-tasks').click();
    const row = page.locator('.g-taskline', { hasText: 'Hi' });
    await row.waitFor();
    assert((await row.innerText()).includes('mydesc2'), 'desc missing');
  });
  await check('P1 chip back to note', async () => {
    await page.getByTestId('nav-tasks').click();
    const row = page.locator('.g-taskline', { hasText: 'Hi' });
    await row.waitFor();
    const chip = row.locator('.g-src');
    assert((await chip.innerText()).includes('из:'), 'no source chip');
    await chip.click();
    await page.locator('.g-title-in').waitFor();
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Alpha', `opened wrong note: ${v}`);
  });

  // ---------- P2: week calendar ----------
  const todayISO = await page.evaluate(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await check('P2 add dated task', async () => {
    await page.getByTestId('nav-tasks').click();
    await page.locator('.g-addtask input').first().fill('Cal task');
    await page.locator('.g-addtask input[type="date"]').fill(todayISO);
    await page.getByRole('button', { name: 'Добавить' }).click();
    await page.locator('.g-taskline', { hasText: 'Cal task' }).waitFor();
  });
  await check('P2 week grid + toggle', async () => {
    await page.getByTestId('nav-cal').click();
    assert((await page.locator('.g-day').count()) === 7, 'not 7 days');
    await page.locator('.g-taskchip', { hasText: 'Cal task' }).waitFor();
    const firstBefore = await page.locator('.g-day-head strong').first().innerText();
    await page.getByLabel('›').click();
    const firstAfter = await page.locator('.g-day-head strong').first().innerText();
    assert(firstBefore !== firstAfter, 'week nav did not move');
    await page.getByLabel('‹').click();
    const chip = page.locator('.g-taskchip', { hasText: 'Cal task' });
    await chip.click();
    assert((await chip.getAttribute('class'))?.includes('done') ?? false, 'toggle failed');
  });
  await check('P2 undated section', async () => {
    const sec = page.locator('.g-undated');
    await sec.waitFor();
    assert((await sec.innerText()).includes('Hi'), 'undated task missing');
  });

  // ---------- GROUP G3-linkcalc: links + calculations (Alpha note) ----------
  await beginGroup('G3-linkcalc', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('a1', 'Alpha')], 'a1') },
  }));

  // ---------- P3: explicit link dialog ----------
  await check('P3 link Beta to Alpha', async () => {
    await page.locator('.g-newbtn').click();
    await page.locator('.g-title-in').fill('Beta');
    await page.getByRole('button', { name: '+ Связать' }).click();
    await page.locator('.g-modal').waitFor();
    const src = await page.locator('.g-linkrow').innerText();
    assert(src.includes('Beta'), `source not shown: ${src}`);
    await page.locator('.g-modal .g-in').fill('Alpha');
    await page.locator('.g-linkitem', { hasText: 'Alpha' }).click();
    const btn = page.locator('.g-modal .g-btn.primary');
    const label = await btn.innerText();
    assert(label.includes('Beta') && label.includes('Alpha'), `confirm vague: ${label}`);
    await btn.click();
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).waitFor();
  });
  await check('P3 unlink', async () => {
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).locator('.g-unlink').click();
    assert((await page.locator('.g-unlink').count()) === 0, 'link not removed');
  });

  // ---------- P4: calculations list ----------
  await check('P4 add calc 2+3*4=14', async () => {
    await page.getByRole('button', { name: '+ Добавить вычисление' }).click();
    await page.locator('.g-calc-name').fill('test');
    await page.locator('.g-calc-expr').fill('2+3*4');
    const res = await page.locator('.g-calc-res').innerText();
    assert(res.includes('14'), `bad result: ${res}`);
  });
  await check('P4 delete calc', async () => {
    await page.locator('.g-calcrow .g-tdel').click();
    assert((await page.locator('.g-calcrow').count()) === 0, 'calc not deleted');
  });



  await check('P4b variables', async () => {
    await page.getByRole('button', { name: '+ Добавить вычисление' }).click();
    await page.locator('.g-calc-name').last().fill('a');
    await page.locator('.g-calc-expr').last().fill('2+3');
    assert((await page.locator('.g-calc-res').last().innerText()).includes('5'), 'a!=5');
    await page.getByRole('button', { name: '+ Добавить вычисление' }).click();
    await page.locator('.g-calc-name').last().fill('b');
    await page.locator('.g-calc-expr').last().click();
    await page.locator('.g-varchip', { hasText: 'a' }).first().click();
    assert((await page.locator('.g-calc-expr').last().inputValue()).includes('a'), 'chip insert failed');
    await page.locator('.g-calc-expr').last().fill('a*10');
    assert((await page.locator('.g-calc-res').last().innerText()).includes('50'), 'b!=50');
  });
  await check('P4b cycle + unknown', async () => {
    const rows = page.locator('.g-calcrow');
    await rows.nth(0).locator('.g-calc-expr').fill('b+1');
    assert((await rows.nth(0).locator('.g-calc-res').innerText()).includes('\u2014'), 'cycle not caught');
    assert((await rows.nth(1).locator('.g-calc-res').innerText()).includes('\u2014'), 'cycle not propagated');
    await rows.nth(0).locator('.g-calc-expr').fill('zzz+1');
    const title = await rows.nth(0).locator('.g-calc-res').getAttribute('title');
    assert((title || '').includes('zzz'), `no unknown hint: ${title}`);
    await rows.nth(1).locator('.g-tdel').click();
    await rows.nth(0).locator('.g-tdel').click();
    assert((await page.locator('.g-calcrow').count()) === 0, 'calcs not deleted');
  });

  // ---------- P7: honest data ----------
  // ---------- GROUP G4-story: Alpha/Beta entry (lock toast), growth in P7 ----------
  await beginGroup('G4-story', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store(storyEntryNotes(), 'b1') },
  }));

  await check('P7 map real clusters', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('.g-toasts').waitFor();
    assert((await page.locator('.g-toasts').innerText()).includes('20'), 'no gate');
    await reseed(page, storyGrownLegacy());
    await page.getByTestId('nav-map').click();
    await page.locator('.g-cluster').first().waitFor();
    const t = await page.locator('.g-map').innerText();
    assert(!t.includes('128'), 'fake count present');
    assert(t.includes('(' + (MAP_UNLOCK + 1) + ')'), `real count missing: ${t.slice(0, 200)}`);
    assert((await page.locator('.g-orphanrow').count()) === MAP_UNLOCK + 1, 'unlinked wrong');
  });
  await check('P7 similar real', async () => {
    await page.getByTestId('nav-home').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    await page.locator('.g-right').waitFor();
    const t = await page.locator('.g-right').innerText();
    assert(t.includes('Alpha'), 'real similar missing');
    assert(!t.includes('Normalization'), 'fake similar present');
  });
  await check('P7 broken flow', async () => {
    await page.getByRole('button', { name: '+ Связать' }).click();
    await page.locator('.g-modal').waitFor();
    await page.locator('.g-modal .g-in').fill('Alpha');
    await page.locator('.g-linkitem', { hasText: 'Alpha' }).click();
    await page.locator('.g-modal .g-btn.primary').click();
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).locator('.g-linkbtn').click();
    await page.locator('.g-docactions .g-abtn.danger').click();
    await page.getByTestId('nav-map').click();
    assert((await page.locator('.g-brokenrow').count()) === 0, 'dangling refs remain');
    await page.getByTestId('nav-home').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-card', { hasText: 'Связанное' }).locator('li').count()) === 0, 'refs not purged');
  });
  await check('P7 rename propagation', async () => {
    await page.locator('.g-newbtn').click();
    await page.locator('.g-title-in').fill('Delta');
    await page.getByRole('button', { name: '+ Связать' }).click();
    await page.locator('.g-modal .g-in').fill('Beta');
    await page.locator('.g-linkitem', { hasText: 'Beta' }).click();
    await page.locator('.g-modal .g-btn.primary').click();
    await page.keyboard.press('Control+k');
    await page.locator('.g-search-in').fill('Beta');
    await page.locator('.g-result', { hasText: 'Beta' }).first().click();
    await page.locator('.g-title-in').fill('Gamma');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+k');
    await page.locator('.g-search-in').fill('Delta');
    await page.locator('.g-result', { hasText: 'Delta' }).first().click();
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Gamma') && !t.includes('Beta'), `refs not updated: ${t}`);
  });
  await check('P7 unique titles', async () => {
    await page.locator('.g-newbtn').click();
    await page.locator('.g-title-in').fill('Gamma');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (document.querySelector('.g-title-in') || {}).value === 'Gamma 2',
      null,
      { timeout: 5000 },
    );
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Gamma 2', `not uniquified: ${v}`);
  });



  await check('P8 rename UX: clear-type-commit', async () => {
    await page.locator('.g-title-in').fill('');
    await page.keyboard.type('Completely New');
    await page.keyboard.press('Enter');
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Completely New', `reverted: ${v}`);
    await page.locator('.g-title-in').fill('Completely Ne');
    const v2 = await page.locator('.g-title-in').inputValue();
    assert(v2 === 'Completely Ne', `jumped while typing: ${v2}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => (document.querySelector('.g-title-in') || {}).value === 'Completely New',
      null,
      { timeout: 5000 },
    );
    const v3 = await page.locator('.g-title-in').inputValue();
    assert(v3 === 'Completely New', `escape did not revert: ${v3}`);
  });


  await check('P9 rail collapse + persist', async () => {
    await page.getByLabel('Меню').click();
    await page.locator('.g-side.rail').waitFor();
    assert((await page.locator('.g-side .g-lbl').count()) === 0, 'labels visible in rail');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.g-side.rail').waitFor();
  });
  await check('P9 create from rail', async () => {
    await page.locator('.g-side.rail .g-newbtn').click();
    await page.locator('.g-title-in').waitFor();
    await page.getByLabel('Меню').click();
    assert((await page.locator('.g-side.rail').count()) === 0, 'not expanded');
  });
  await check('P9 center capped', async () => {
    const mw = await page.evaluate(() => getComputedStyle(document.querySelector('.g-center')).maxWidth);
    assert(mw === '820px', `maxWidth ${mw}`);
  });


  await check('P10 right collapse + Alt+0', async () => {
    await page.getByLabel('Правая панель').click();
    await page.locator('.g-rail-r').waitFor();
    assert((await page.locator('.g-right').count()) === 0, 'right still visible');
    await page.getByLabel('Меню').click();
    await page.keyboard.press('Alt+0');
    assert((await page.locator('.g-side.rail').count()) === 0, 'sidebar not reset');
    assert((await page.locator('.g-rail-r').count()) === 0, 'right not reset');
    assert((await page.locator('.g-right').count()) === 1, 'right not open');
  });


  await check('P11 notes list open+delete', async () => {
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow').first().waitFor();
    assert((await page.locator('.g-noterow').count()) >= 3, 'few rows');
    await page.locator('.g-noterow', { hasText: 'Gamma' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-title-in').inputValue()) === 'Gamma', 'not opened');
  });
  await check('P11 backlinks both ways', async () => {
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Delta'), `no incoming: ${t}`);
  });
  await check('P11 delete Seed 20 from list', async () => {
    await page.getByTestId('nav-home').click();
    await page.locator('.g-notes-tools .g-in').fill('Seed 20');
    const row = page.locator('.g-noterow', { hasText: 'Seed 20' });
    await row.locator('.g-notedel').click();
    assert((await page.locator('.g-noterow', { hasText: 'Seed 20' }).count()) === 1, 'deleted without confirm');
    assert((await row.locator('.g-notedel.g-danger-arm').count()) === 1, 'no arm state');
    await row.locator('.g-notedel').click();
    assert((await page.locator('.g-noterow', { hasText: 'Seed 20' }).count()) === 0, 'not deleted');
  });


  await check('P12 graph create+rename', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByRole('button', { name: '+ Новый' }).click();
    await page.locator('.g-gtitle-in').fill('Math');
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-gtabs').innerText()).includes('Math'), 'no Math tab');
  });
  await check('P12 assign isolates nodes', async () => {
    const st = async (n, f) => { try { await f(); } catch (e) { throw new Error(n + ' :: ' + String(e).split('\n')[0]); } };
    await st('open-members', async () => {
      await page.getByRole('button', { name: '+ Заметки' }).click();
      await page.locator('.g-modal').waitFor({ timeout: 8000 });
    });
    await st('check-gamma', async () => {
      await page.locator('.g-memberrow', { hasText: 'Gamma' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('check-delta', async () => {
      await page.locator('.g-memberrow', { hasText: 'Delta' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('close-modal', async () => {
      await page.locator('.g-modal-x').click({ timeout: 8000 });
    });
    assert((await page.locator('circle.g-vnode').count()) === 2, 'not isolated');
    assert((await page.locator('line.g-vedge').count()) >= 1, 'no edges in Math');
    await page.locator('.g-gtabs').getByRole('button', { name: /HCI/ }).click();
    const hci = await page.locator('circle.g-vnode').count();
    assert(hci > 2, `HCI small: ${hci}`);
  });
  await check('P12 zoom+drag', async () => {
    const before = await page.locator('g.g-view').getAttribute('transform');
    await page.getByLabel('Приблизить').click();
    const after = await page.locator('g.g-view').getAttribute('transform');
    assert(before !== after && (after || '').includes('1.25'), `no zoom: ${after}`);
    const c0 = page.locator('circle.g-vnode').first();
    const cx0 = await c0.getAttribute('cx');
    const box = await c0.boundingBox();
    assert(!!box, 'no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    const cx1 = await c0.getAttribute('cx');
    assert(cx0 !== cx1, 'drag did not move');
  });

  await check('P12 hit zone r24', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('.g-gtabs').getByRole('button', { name: /Math/ }).click();
    // The tab switch resets pan/zoom asynchronously (MapPage view effect):
    // geometry must be read after the reset lands, never on a stale
    // transform left by P12 zoom+drag (STAGE_11 flake root cause).
    await page.waitForFunction(
      () => document.querySelector('g.g-view')?.getAttribute('transform') === 'translate(0 0) scale(1)',
      null,
      { timeout: 8000 },
    );
    const pt = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const cc = svg.querySelector('circle.g-vnode');
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / 800, r.height / 500);
      const ox = (r.width - 800 * s) / 2, oy = (r.height - 500 * s) / 2;
      const g = svg.querySelector('g.g-view');
      const mm = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform'));
      const tx = +mm[1], ty = +mm[2], k = +mm[3];
      const cx = +cc.getAttribute('cx'), cy = +cc.getAttribute('cy');
      return { x: r.left + ox + (cx * k + tx) * s + 20 * s * k, y: r.top + oy + (cy * k + ty) * s };
    });
    await page.mouse.click(pt.x, pt.y);
    const sel = await page.locator('.g-preview-card strong').innerText();
    assert(['Gamma', 'Delta'].includes(sel), `wrong selection: ${sel}`);
  });
  await check('P12 pan moves canvas', async () => {
    const before = await page.locator('g.g-view').getAttribute('transform');
    const pt = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const r = svg.getBoundingClientRect();
      const spots = [[10, 10], [r.width - 10, 10], [10, r.height - 10]];
      for (const [x, y] of spots) {
        const el = document.elementFromPoint(r.left + x, r.top + y);
        if (el && (el === svg || el.tagName === 'svg')) return { x: r.left + x, y: r.top + y };
      }
      return { x: r.left + 10, y: r.top + 10 };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 120, pt.y + 60, { steps: 10 });
    await page.mouse.up();
    const after = await page.locator('g.g-view').getAttribute('transform');
    assert(before !== after, 'pan did not move');
  });


  await check('P12 ungrouped regression', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByRole('button', { name: '+ Новый' }).click();
    await page.getByRole('button', { name: 'Удалить граф' }).click();
    await page.getByRole('button', { name: /Точно/ }).click();
    await page.locator('.g-newbtn').click();
    await page.getByTestId('nav-map').click();
    const t = await page.locator('.g-cluster', { hasText: 'Без графа' }).innerText();
    assert(t.includes('Новая заметка'), `new note not ungrouped: ${t.slice(0, 120)}`);
  });

  await check('P12 delete keeps notes', async () => {
    await page.locator('.g-gtabs').getByRole('button', { name: /Math/ }).click();
    await page.getByTestId('nav-home').click();
    const before = await page.locator('.g-noterow').count();
    await page.getByTestId('nav-map').click();
    await page.locator('.g-gtabs').getByRole('button', { name: /Math/ }).click();
    await page.getByRole('button', { name: 'Удалить граф' }).click();
    await page.getByRole('button', { name: /Точно/ }).click();
    await page.getByTestId('nav-home').click();
    const after = await page.locator('.g-noterow').count();
    assert(before === after && before > 0, `notes lost: ${before} vs ${after}`);
  });


  // ---------- GROUP G5-prompt: prompt page on an empty store ----------
  await beginGroup('G5-prompt', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], '') },
  }));

  await check('P13 prompt saves directly as editable template', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('.g-prompt').waitFor();
    await page.locator('.g-prompt input[aria-label="prompt"]').fill('blue');
    await page.locator('.g-tagrow').first().click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).first().click();
    const editor = page.locator('.g-modal');
    await editor.waitFor();
    const templateName = 'Blue eyes template';
    await editor.locator('input.g-in').first().fill(templateName);
    assert((await editor.locator('textarea.g-tbody').inputValue()).includes('blue eyes'), 'generated prompt not prefilled');
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const mini = page.locator('.g-tpl-mini', { hasText: templateName });
    await mini.waitFor();
    assert(!(await page.locator('.g-card').allInnerTexts()).some((text) => text.includes('Сохранённые')), 'saved card still present');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-prompt').click();
    await page.locator('.g-tpl-mini', { hasText: templateName }).waitFor();
    await page.locator('.g-tpl-mini', { hasText: templateName }).click();
    const card = page.locator('.g-tpl', { hasText: templateName });
    await card.getByRole('button', { name: /Изменить/ }).click();
    const edit = page.locator('.g-modal');
    await edit.waitFor();
    assert((await edit.locator('input.g-in').first().inputValue()) === templateName, 'template is not editable');
    await edit.locator('textarea.g-tbody').fill('blue hair and {{style}}');
    await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('.g-tpl', { hasText: templateName }).getByRole('button', { name: /Удалить/ }).click();
    assert((await page.locator('.g-tpl-mini', { hasText: templateName }).count()) === 0, 'template not deleted');
  });
  await check('P13 llm template save', async () => {
    assert((await page.locator('.g-tpl').count()) === 0, 'cards must start collapsed');
    await page.locator('.g-tpl-mini').first().click();
    await page.locator('.g-tpl').first().getByRole('button', { name: 'Сохранить заполненное' }).click();
    await page.locator('.g-tpl-tools .g-in').fill('sql');
    assert((await page.locator('.g-tpl-mini').count()) === 1, 'search must narrow minis');
    await page.locator('.g-tpl-tools .g-in').fill('');
    await page.locator('.g-sugg', { hasText: 'Code review' }).waitFor();
  });


  await check('P13b bind to note + open + unbind', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('.g-prompt').waitFor();
    await page.locator('.g-prompt input[aria-label="prompt"]').fill('blue');
    await page.locator('.g-tagrow').first().click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).first().click();
    const editor = page.locator('.g-modal');
    await editor.waitFor();
    await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const mini = page.locator('.g-tpl-mini', { hasText: 'blue eyes' }).first();
    await mini.waitFor();
    const tpl = page.locator('.g-tpl', { hasText: 'blue eyes' }).first();
    await tpl.getByRole('button', { name: 'Сохранить заполненное' }).click();
    await page.locator('.g-sugg', { hasText: 'blue eyes' }).first().waitFor();
    await page.locator('.g-newbtn').click();
    await page.locator('.g-title-in').fill('Prompthost');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-prompt').click();
    await mini.click();
    await page.locator('.g-sugg', { hasText: 'blue eyes' }).first().getByRole('button', { name: 'В заметку' }).click();
    await page.locator('.g-modal .g-in').fill('Prompthost');
    await page.locator('.g-linkitem', { hasText: 'Prompthost' }).click();
    await page.locator('.g-sugg', { hasText: 'blue eyes' }).first().getByRole('button', { name: /Prompthost/ }).waitFor();
    await page.locator('.g-sugg', { hasText: 'blue eyes' }).first().getByRole('button', { name: /Prompthost/ }).click();
    await page.locator('.g-card', { hasText: 'Промпты' }).waitFor();
    assert((await page.locator('.g-card', { hasText: 'Промпты' }).innerText()).includes('blue eyes'), 'not linked');
    await page.locator('.g-card', { hasText: 'Промпты' }).getByRole('button', { name: 'Открыть' }).click();
    const openedTemplate = page.locator('.g-tpl', { hasText: 'blue eyes' }).first();
    await openedTemplate.waitFor({ timeout: 8000 });
    assert((await openedTemplate.innerText()).includes('blue eyes'), 'linked template did not open');
    await page.keyboard.press('Control+k');
    await page.locator('.g-search-in').fill('Prompthost');
    await page.locator('.g-result', { hasText: 'Prompthost' }).first().click();
    await page.locator('.g-card', { hasText: 'Промпты' }).getByRole('button', { name: 'Отвязать' }).click();
    assert((await page.locator('.g-card', { hasText: 'Промпты' }).innerText()).includes('Нет привязанных'), 'not unbound');
  });


  await check('P13c keyboard picks tag', async () => {
    await page.getByTestId('nav-prompt').click();
    assert((await page.locator('.g-card.ok').innerText()).includes('1.0.0-sample'), 'no dataset version');
    await page.locator('.g-prompt input[aria-label="prompt"]').fill('blue');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.g-tokens', { hasText: 'blue hair' }).waitFor();
  });


  await check('P13d gradient + syntax + risk banner', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('.g-prompt input[aria-label="prompt"]').fill('blue');
    const fill = await page.locator('.g-tagrow circle').first().getAttribute('fill');
    assert(fill === 'var(--ok)', `not banded: ${fill}`);
    await page.getByRole('radio', { name: 'SDXL' }).click();
    await page.locator('.g-prompt input[aria-label="prompt"]').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    const sdxlEditor = page.locator('.g-modal');
    const sdxlBody = await sdxlEditor.locator('textarea.g-tbody').inputValue();
    assert(sdxlBody.includes('(') && /blue (hair|eyes)/.test(sdxlBody), `bad SDXL body: ${sdxlBody}`);
    await sdxlEditor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const sdxlCard = page.locator('[data-testid^="tpl-card-"]').filter({ hasText: 'SDXL' });
    const sdxlPreview = await sdxlCard.locator('.g-tpl-prev').innerText();
    assert(sdxlPreview.includes('('), `no SDXL parens: ${sdxlPreview}`);
    await page.getByRole('radio', { name: 'Flux' }).click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    const fluxEditor = page.locator('.g-modal');
    const fluxBody = await fluxEditor.locator('textarea.g-tbody').inputValue();
    assert(/blue (hair|eyes)/.test(fluxBody) && !fluxBody.includes('('), `bad Flux body: ${fluxBody}`);
    await fluxEditor.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const fluxCard = page.locator('[data-testid^="tpl-card-"]').filter({ hasText: 'Flux' });
    const fluxPreview = await fluxCard.locator('.g-tpl-prev').innerText();
    assert(/blue (hair|eyes)/.test(fluxPreview) && !fluxPreview.includes('('), `bad Flux preview: ${fluxPreview}`);
    await page.getByRole('radio', { name: 'Pony' }).click();
    await page.locator('.g-prompt input[aria-label="prompt"]').fill('blue skin');
    await page.locator('.g-tagrow').first().click();
    const banner = await page.locator('.g-banner-warn').innerText();
    assert(banner.includes('12'), `banner hides rate: ${banner}`);
  });

  await check('P14 no cloud sync wording', async () => {
    // The header honestly shows Сохраняется… while a save is armed: let the
    // debounce window settle so the wording assertions read a final state.
    await page.waitForFunction(
      () => !document.querySelector('.g-status')?.textContent?.includes('Сохраняется'),
      null,
      { timeout: 8000 },
    );
    const top = await page.locator('.g-topbar').innerText();
    assert(top.includes('Сохранено локально'), `topbar: ${top}`);
    assert(!top.includes('синхронизировано'), 'sync illusion in topbar');
    assert((await page.getByRole('button', { name: 'Синхронизировать' }).count()) === 0, 'sync button present');
    const main = await page.locator('.g-main').innerText();
    assert(!main.includes('синхронизировано') && !main.includes('Синхронизировать'), 'sync wording on page');
  });

  // ---------- GROUP G6-tasks: settings, snippets, trash, adopted tasks (one Probe note) ----------
  await beginGroup('G6-tasks', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('pn', 'Probe')], 'pn') },
  }));

    await check('P15 settings panel real', async () => {
    await page.getByTestId('nav-settings').click();
    await page.locator('.g-modal').waitFor();
    const t = await page.locator('.g-modal').innerText();
    assert(t.includes('Тема') || t.includes('Theme') || t.includes('Тақырып'), `no labels: ${t}`);
    await page.locator('.g-modal').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'theme not applied');
    await page.locator('.g-modal').getByRole('button', { name: 'Светлая', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'light', 'theme not reverted');
    await page.locator('.g-modal').getByRole('button', { name: '25', exact: true }).click();
    assert((await page.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith("grafnot-list-limits"));
      return JSON.parse(window.localStorage.getItem(key) || "{}").prompts;
    })) === 25, 'limit not persisted');
    assert((await page.evaluate(() => window.localStorage.getItem('grafnot-tpl-limit'))) === null, 'legacy key not migrated');
    await page.locator('.g-modal').getByRole('button', { name: '10', exact: true }).click();
    await page.locator('.g-modal .g-modal-x').click();
    assert((await page.locator('.g-modal').count()) === 0, 'modal not closed');
  });

    await check('P16 note snippets termed заготовки', async () => {
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    const panel = await page.locator('.g-right').innerText();
    assert(panel.includes('Заготовки'), `no snippets title: ${panel}`);
    assert(!panel.includes('Шаблоны'), 'old term present');
    await page.locator('.g-right').getByRole('button', { name: 'Лекция', exact: true }).click();
    await page.locator('.g-toasts', { hasText: 'Заготовка вставлена' }).waitFor();
    await page.locator('.tiptap', { hasText: 'Лекция' }).waitFor();
  });

    await check('P17a task to trash and restore', async () => {
    await page.getByTestId('nav-tasks').click();
    await page.locator('.g-page input[aria-label="new task"]').fill('TrashProbe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).locator('.g-tdel').click();
    assert((await page.locator('.g-taskline', { hasText: 'TrashProbe' }).count()) === 1, 'trashed without confirm');
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).locator('.g-tdel').click();
    assert((await page.locator('.g-taskline', { hasText: 'TrashProbe' }).count()) === 0, 'task not trashed');
    await page.getByTestId('nav-trash').click();
    await page.locator('.g-modal', { hasText: 'TrashProbe' }).waitFor();
    await page.locator('.g-sugg', { hasText: 'TrashProbe' }).getByRole('button', { name: 'восстановить' }).click();
    assert((await page.locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not restored');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-tasks').click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
  });

  await check('P17b purge needs arm confirm', async () => {
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).locator('.g-tdel').click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).locator('.g-tdel').click();
    await page.getByTestId('nav-trash').click();
    const trow = page.locator('.g-sugg', { hasText: 'TrashProbe' });
    await trow.getByRole('button', { name: 'Удалить навсегда' }).click();
    assert((await page.locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 1, 'purged without confirm');
    await trow.getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not purged');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow').first().locator('.g-notedel').click();
    await page.locator('.g-noterow').first().locator('.g-notedel').click();
    await page.getByTestId('nav-trash').click();
    const n0 = await page.locator('.g-modal .g-sugg').count();
    await page.locator('.g-modal .g-sugg').first().getByRole('button', { name: 'Удалить навсегда' }).click();
    assert((await page.locator('.g-modal .g-sugg').count()) === n0, 'note purged without confirm');
    await page.locator('.g-modal .g-sugg').first().getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.locator('.g-modal .g-sugg').count()) === n0 - 1, 'note not purged');
  });

  await check('P17c old store without trashTasks migrates', async () => {
    await reseed(page, seedLegacy({
      schemaVersion: 4,
      notes: [],
      tasks: [{ id: 't1', text: 'Old', done: false }],
      trash: [],
      graphs: [],
      prompts: [],
      customTpls: [],
      activeId: '',
    }));
    await page.getByTestId('nav-tasks').click();
    await page.locator('.g-taskline', { hasText: 'Old' }).waitFor();
    await page.getByTestId('nav-trash').click();
    await page.locator('.g-modal', { hasText: 'Корзина пуста' }).waitFor();
  });

    await check('P18 ctrl+k finds saved prompt and opens its card', async () => {
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-prompt').click();
    await page.locator('.g-tpl-mini').first().click();
    await page.locator('.g-tpl').first().getByRole('button', { name: 'Сохранить заполненное' }).click();
    await page.keyboard.press('Control+k');
    await page.locator('.g-search-in').fill('code review');
    const res = page.locator('.g-result', { hasText: 'Code review' });
    await res.first().waitFor();
    assert((await page.locator('.g-results').innerText()).includes('промпт'), 'no prompt kind');
    await res.first().click();
    await page.locator('#tplcard-cr .g-tpl').waitFor();
  });

  await check('P18b legacy image saves become editable templates', async () => {
    await reseed(page, seedLegacy({
      schemaVersion: 5,
      notes: [{ id: 'n-old', title: 'Legacy note', content: '', text: '', linkedIds: [], calcs: [], updated: 1 }],
      tasks: [],
      trash: [],
      trashTasks: [],
      graphs: [],
      prompts: [{ id: 'p-old', kind: 'image', title: 'Legacy blue art', model: 'SDXL', tokens: ['blue hair'], noteId: 'n-old', created: 1 }],
      customTpls: [],
      activeId: 'n-old',
    }));
    await page.getByTestId('nav-prompt').click();
    const mini = page.locator('.g-tpl-mini', { hasText: 'Legacy blue art' });
    await mini.waitFor();
    await mini.click();
    const template = page.locator('.g-tpl', { hasText: 'Legacy blue art' }).first();
    await template.waitFor();
    assert((await template.locator('.g-tpl-prev').innerText()).includes('(blue hair)'), 'legacy image syntax lost');
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow', { hasText: 'Legacy note' }).first().locator('.g-noteopen').click();
    const prompts = page.locator('.g-card', { hasText: 'Промпты' });
    await prompts.waitFor();
    assert((await prompts.innerText()).includes('Legacy blue art'), 'legacy note link lost');
  });

  // ---------- GROUP G7-lists: legacy list/search/limit seeds (each check reseeds) ----------
  currentGroup = 'G7-lists';

    await check('P19 notes list limit search keyboard', async () => {
    await reseed(page, seedLegacy((() => {
      const notes = [];
      for (let i = 1; i <= 12; i++) {
        const n = i < 10 ? '0' + i : '' + i;
        notes.push({ id: 'sn' + i, title: 'Seed Note ' + n, content: '', text: i === 3 ? 'Zebra stripes here' : 'plain body ' + i, linkedIds: [], calcs: [], updated: Date.now() - i * 1000 });
      }
      return { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'sn1' };
    })()));
    await page.getByTestId('nav-home').click();
    assert((await page.locator('.g-noterow').count()) === 10, 'default limit not applied');
    await page.locator('.g-notes-tools .g-seg').getByRole('button', { name: '5', exact: true }).click();
    assert((await page.locator('.g-noterow').count()) === 5, 'limit seg broken');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    assert((await page.locator('.g-noterow').count()) === 10, 'show more broken');
    await page.locator('.g-notes-tools .g-seg').getByRole('button', { name: '10', exact: true }).click();
    await page.locator('.g-notes-tools .g-in').fill('zebra');
    assert((await page.locator('.g-noterow').count()) === 1, 'search must narrow first');
    await page.locator('.g-notes-tools .g-in').fill('');
    assert((await page.locator('.g-noterow').count()) === 10, 'clear must restore limit');
    await page.locator('.g-notes-tools .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-title-in').inputValue()) === 'Seed Note 02', 'keyboard opened wrong note');
  });

    await check('P20 tasks search filter limit keyboard', async () => {
    await reseed(page, seedLegacy((() => {
      const tasks = [];
      for (let i = 1; i <= 12; i++) {
        tasks.push({ id: 'st' + i, text: 'Seed task ' + i, done: i > 9, noteId: undefined });
      }
      tasks[0].text = 'Fix login button';
      tasks[10].text = 'Login audit';
      return { schemaVersion: 5, notes: [], tasks, trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: '' };
    })()));
    await page.getByTestId('nav-tasks').click();
    assert((await page.locator('.g-taskline').count()) === 9, 'active filter or limit off');
    await page.locator('.g-notes-tools .g-seg').getByRole('button', { name: '5', exact: true }).click();
    assert((await page.locator('.g-taskline').count()) === 5, 'limit seg broken');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    assert((await page.locator('.g-taskline').count()) === 9, 'show more broken');
    await page.locator('.g-notes-tools .g-seg').getByRole('button', { name: '10', exact: true }).click();
    await page.getByRole('button', { name: 'Выполненные' }).click();
    await page.locator('.g-notes-tools .g-in').fill('login');
    assert((await page.locator('.g-taskline').count()) === 1, 'filter plus search broken');
    await page.locator('.g-notes-tools .g-in').fill('');
    await page.getByRole('button', { name: 'Активные' }).click();
    await page.locator('.g-notes-tools .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-taskline').count()) === 8, 'keyboard toggle broken');
    await page.locator('.g-taskline').first().locator('.g-tdel').click();
    assert((await page.locator('.g-taskline').count()) === 8, 'deleted without confirm');
    await page.locator('.g-taskline').first().locator('.g-tdel').click();
    assert((await page.locator('.g-taskline').count()) === 7, 'task delete broken');
    await page.getByTestId('nav-trash').click();
    await page.locator('.g-modal', { hasText: 'Fix login button' }).waitFor();
  });

  await check('P21 graph members search limit checkbox', async () => {
    await page.keyboard.press('Escape');
    await reseed(page, seedLegacy((() => {
      const notes = [];
      for (let i = 1; i <= MAP_UNLOCK; i++) {
        const n = i < 10 ? '0' + i : '' + i;
        notes.push({ id: 'mm' + i, title: 'Member ' + n, content: '', text: '', linkedIds: [], calcs: [], updated: Date.now() - i * 1000 });
      }
      return { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [{ id: 'g1', title: 'Team', noteIds: ['mm1'] }], prompts: [], customTpls: [], activeId: 'mm1' };
    })()));
    await page.getByTestId('nav-map').click();
    await page.locator('.g-gtabs').getByRole('button', { name: /Team/ }).click();
    await page.getByRole('button', { name: '+ Заметки' }).click();
    assert((await page.locator('.g-modal .g-memberrow').count()) === 10, 'members not listed');
    await page.locator('.g-modal .g-seg').getByRole('button', { name: '5', exact: true }).click();
    assert((await page.locator('.g-modal .g-memberrow').count()) === 5, 'member limit broken');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    assert((await page.locator('.g-modal .g-memberrow').count()) === 10, 'member show more broken');
    await page.locator('.g-modal .g-in').fill('Member 03');
    assert((await page.locator('.g-modal .g-memberrow').count()) === 1, 'member search broken');
    const box = page.locator('.g-modal .g-memberrow input');
    assert((await box.isChecked()) === false, 'already a member');
    await box.check();
    assert((await box.isChecked()) === true, 'checkbox toggle broken');
    await box.uncheck();
    await page.locator('.g-modal .g-in').fill('');
    await page.locator('.g-modal .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const box2 = page.locator('.g-modal .g-memberrow input').nth(1);
    assert((await box2.isChecked()) === true, 'keyboard toggle broken');
  });

  // ---------- GROUP G8-mobile: isolated context, empty storage ----------
  if (await groupActive('G8-mobile')) {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storageStateFor({}) });
    const m = await mctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });

    await check('P22 mobile bottombar more sheet', async () => {
    assert(await m.locator('.g-bottombar').isVisible(), 'no bottombar');
    assert((await m.locator('.g-bottombar .g-bitem').count()) === 5, 'not 5 items');
    await m.locator('.g-bottombar').getByRole('button', { name: 'Ещё' }).click();
    await m.locator('.g-modal').waitFor();
    await m.locator('.g-modal').getByRole('button', { name: 'Промпт-помощник' }).click();
    await m.locator('.g-prompt').waitFor();
    const moreBtn = m.locator('.g-bottombar').getByRole('button', { name: 'Ещё' });
    assert(((await moreBtn.getAttribute('class')) || '').includes('active'), 'more not active');
    await moreBtn.click();
    await m.locator('.g-modal').getByRole('button', { name: /Карта знаний/ }).click();
    await m.locator('.g-toasts', { hasText: 'Pro' }).waitFor();
    });

    await m.close();
    await mctx.close();
  }

  // ---------- GROUP G9-profiles: avatar, shortcuts, toasts, profiles (empty start) ----------
  await beginGroup('G9-profiles', {});

    await check('P23 avatar opens settings', async () => {
    // Tolerates a lingering modal from the previous group (chain) or none (filtered run).
    if ((await page.locator('.g-modal .g-modal-x').count()) > 0) await page.locator('.g-modal .g-modal-x').click();
    await page.locator('button.g-avatar').click();
    await page.locator('.g-modal', { hasText: 'Тема' }).waitFor();
    await page.keyboard.press('Escape');
    assert((await page.locator('.g-modal').count()) === 0, 'not closed');
    await page.locator('button.g-avatar').focus();
    await page.keyboard.press('Enter');
    await page.locator('.g-modal', { hasText: 'Тема' }).waitFor();
    await page.locator('.g-modal .g-modal-x').click();
  });

    await check('P24 shortcuts help modal', async () => {
    await page.locator('.g-topbar').getByRole('button', { name: 'Горячие клавиши' }).click();
    const modal = page.locator('.g-modal');
    await modal.waitFor();
    const t = await modal.innerText();
    assert(t.includes('Глобальный поиск') && t.includes('Ctrl K'), 'no search row');
    assert(t.includes('Сбросить панели') && t.includes('Alt 0'), 'no panels row');
    assert(t.includes('Новая заметка') && t.includes('Ctrl Alt N'), 'no new note row');
    await page.keyboard.press('Escape');
    assert((await page.locator('.g-modal').count()) === 0, 'not closed');
  });

    await check('P25 toast manual close', async () => {
    await page.getByTestId('nav-tasks').click();
    const box = page.locator('.g-page input[aria-label="new task"]');
    await box.fill('First toast probe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    assert((await page.locator('.g-toast').count()) === 0, 'not closed manually');
    await box.fill('Second toast probe with a very long tail ' + 'x'.repeat(160));
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await box.fill('Third toast probe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    assert((await page.locator('.g-toast').count()) === 2, 'stack broken');
    const t = await page.locator('.g-toast').first().innerText();
    assert(t.includes('Задача добавлена'), `wrong toast: ${t}`);
    assert((await page.locator('.g-taskline', { hasText: 'Second toast probe' }).count()) === 1, 'long text broken');
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    assert((await page.locator('.g-toast').count()) === 1, 'wrong one closed');
    await page.locator('.g-toast').waitFor({ state: 'detached' });
  });

  await check('P26 profiles isolate data and prefs', async () => {
    await resetStorage(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.g-empty-t').waitFor();
    assert((await page.locator('[data-testid="profile-picker"]').count()) === 0, 'no auto-enter');
    await page.locator('.g-empty button').click();
    await page.locator('.g-title-in').fill('ProfileA-note');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 1, 'one row');
    await page.locator('[data-testid="profile-name-in"]').fill('Второй');
    await page.getByRole('button', { name: '+ Новый профиль' }).click();
    await page.locator('.g-empty-t').waitFor();
    await page.getByTestId('nav-home').click();
    assert((await page.locator('.g-noterow').count()) === 0, 'second not empty');
    await page.getByTestId('nav-settings').click();
    await page.locator('.g-modal').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'dark not applied');
    await page.locator('.g-modal').getByRole('button', { name: 'EN', exact: true }).click();
    assert((await page.locator('.g-modal').innerText()).includes('Settings'), 'lang not applied');
    await page.locator('.g-modal').getByRole('button', { name: 'RU', exact: true }).click();
    await page.locator('.g-modal .g-modal-x').click();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'two rows');
    await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Основной' }).getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow', { hasText: 'ProfileA-note' }).waitFor();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'light', 'theme leaked');
  });

  await check('P26b delete profile wipes its data', async () => {
    const victim = await page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')).profiles.find((p) => p.name === 'Второй').id);
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    const row = page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Второй' });
    await row.getByRole('button', { name: 'Удалить навсегда' }).click();
    await row.getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Второй' }).count()) === 0, 'row left');
    const left = await page.evaluate((id) => ({
      stores: Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')),
      stray: Object.keys(window.localStorage).filter((k) => k.includes(id)),
      reg: JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')).profiles.length,
    }), victim);
    assert(left.stores.length === 1 && left.stray.length === 0 && left.reg === 1, `data left: ${JSON.stringify(left)}`);
    await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Основной' }).getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow', { hasText: 'ProfileA-note' }).waitFor();
  });

  // ---------- GROUP G10-p27: duplicate/export/lang/quota (d1 note) + mobile lock ----------
  if (await groupActive('G10-p27')) {
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: { p1: v5store([seedNote('d1', 'Dup me', { text: 'body here' })], 'd1') },
    }));

  // ---------- P27: uncovered paths (STAGE_15) ----------
  await check('P27 duplicate copies note', async () => {
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow', { hasText: 'Dup me' }).locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value?.includes('Дублировать'), null, { timeout: 8000 });
    await page.waitForFunction(() => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).some((k) => (window.localStorage.getItem(k) || '').includes('Дублировать')), null, { timeout: 8000 });
  });

  await check('P27 export downloads markdown', async () => {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.getByRole('button', { name: 'Экспорт .md' }).click(),
    ]);
    assert((await dl.suggestedFilename()).endsWith('.md'), 'bad filename');
    await page.locator('.g-toasts', { hasText: 'скачан' }).waitFor();
  });

  await check('P27 KZ toggle', async () => {
    await page.getByTestId('nav-settings').click();
    await page.locator('.g-modal').waitFor();
    await page.locator('.g-modal').getByRole('button', { name: 'KZ', exact: true }).click();
    assert((await page.locator('.g-modal').innerText()).includes('Тақырып'), 'KZ not applied');
    await page.locator('.g-modal').getByRole('button', { name: 'RU', exact: true }).click();
    assert((await page.locator('.g-modal').innerText()).includes('Тема'), 'RU not restored');
    await page.locator('.g-modal .g-modal-x').click();
  });

  await check('P27 quota fails loud once, never spams', async () => {
    await page.evaluate(() => {
      const orig = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (k, v) => {
        if (String(k).startsWith('grafnot-store-')) throw new Error('quota');
        return orig(k, v);
      };
    });
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('.g-title-in').fill('Quota probe one');
    await page.locator('.g-title-in').press('Enter');
    await page.locator('.g-toast', { hasText: 'переполнено' }).waitFor({ timeout: 8000 });
    await page.locator('.g-title-in').fill('Quota probe two');
    await page.locator('.g-title-in').press('Enter');
    // Negative wait: a second debounce cycle (400ms) must NOT add a second toast.
    await page.waitForTimeout(800);
    assert((await page.locator('.g-toast', { hasText: 'переполнено' }).count()) === 1, 'spam or silent');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-home').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-title-in').inputValue()).includes('Дублировать'), 'last-good lost');
  });

    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storageStateFor(seedLegacy({ schemaVersion: 5, notes: [{ id: 'w1', title: 'W1', content: '', text: '', linkedIds: [], calcs: [], updated: 1 }], tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'w1' })) });
    const m = await mctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
  await check('P27 mobile locked map explains itself', async () => {
    await m.locator('.g-bottombar').getByRole('button', { name: 'Ещё' }).click();
    await m.locator('.g-modal').waitFor();
    await m.locator('.g-modal').getByRole('button', { name: /Карта знаний/ }).click();
    await m.locator('.g-maplocked').waitFor();
    assert((await m.locator('.g-maplocked .g-h2').innerText()).includes('/20'), 'no progress');
    await m.locator('.g-toasts', { hasText: 'Pro' }).waitFor();
  });
    await m.close();
    await mctx.close();
  }

  // ---------- GROUP G12-blocked: damaged stores are never overwritten (STAGE 04) ----------
  // Each check seeds a raw store, loads the app, waits out the autosave
  // window (400ms debounce) and requires the raw key byte-identical.
  if (await groupActive('G12-blocked')) {
    const blockedSeed = (rawStore) => seedProfiles({
      profiles: [{ id: 'b1', name: 'Основной', created: 1 }],
      activeId: 'b1',
      stores: { b1: rawStore },
    });
    const rawOf = (k) => page.evaluate((key) => window.localStorage.getItem(key), k);
    await check('P29 damaged graphs never overwritten', async () => {
      const raw = JSON.stringify({ notes: [], tasks: [], graphs: [null], activeId: '' });
      await reseed(page, blockedSeed(raw));
      await page.waitForTimeout(1500);
      assert((await rawOf('grafnot-store-b1')) === raw, 'autosave rewrote the key');
    });
    await check('P29 truncated JSON never overwritten', async () => {
      const raw = '{"notes": [broken';
      await reseed(page, blockedSeed(raw));
      await page.waitForTimeout(1500);
      assert((await rawOf('grafnot-store-b1')) === raw, 'autosave rewrote the key');
      assert((await page.locator('.g-banner[role="alert"]').count()) > 0, 'no blocked banner');
    });
    await check('P29 future schema never overwritten', async () => {
      const raw = JSON.stringify({ schemaVersion: 6, notes: [], tasks: [], activeId: '' });
      await reseed(page, blockedSeed(raw));
      await page.waitForTimeout(1500);
      assert((await rawOf('grafnot-store-b1')) === raw, 'autosave rewrote the key');
      assert((await page.locator('.g-banner[role="alert"]').count()) > 0, 'no blocked banner');
    });
  }

  // Stage-02 acceptance: no orphan profile stores after a FULL run.
  // Skipped for filtered runs (they end mid-state on purpose).
  if (GROUP_FILTER.length === 0) {
    const endKeys = await page.evaluate(() => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-')));
    if (process.env.VERBOSE) console.log('storage keys at end: ' + JSON.stringify(endKeys));
    const orphans = await page.evaluate(() => {
      let reg = null;
      try { reg = JSON.parse(window.localStorage.getItem('grafnot-profiles-v1') || 'null'); } catch { reg = null; }
      const ids = new Set(((reg && reg.profiles) || []).map((p) => p.id));
      return Object.keys(window.localStorage).filter((k) => {
        if (k === 'grafnot-store-v2' || !k.startsWith('grafnot-store-')) return false;
        if (k.includes(':corrupt-')) return false; // timestamped backups, not stores
        return !ids.has(k.slice('grafnot-store-'.length));
      });
    });
    if (orphans.length > 0) tailFailure = 'orphan profile stores left: ' + orphans.join(',');
  }

  // ---------- GROUP G11-selftest: two tabs share one localStorage (STAGE 02.6) ----------
  await beginGroup('G11-selftest', {});
  await check('P28 second tab shares storage', async () => {
    const t2 = await openSecondTab(ctx);
    await t2.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.localStorage.setItem('grafnot-selftest-marker', 'tab1'));
    const seen = await t2.evaluate(() => window.localStorage.getItem('grafnot-selftest-marker'));
    assert(seen === 'tab1', 'second tab sees different storage');
    await t2.close();
    await page.evaluate(() => window.localStorage.removeItem('grafnot-selftest-marker'));
  });

  // ---------- GROUP G13-error: chunk crashes show a reload fallback (STAGE 05) ----------
  // Fresh contexts (empty HTTP cache) so the chunk is really requested and
  // the route really fires. Routes are removed in finally: a failing check
  // must not poison later groups.
  if (await groupActive('G13-error')) {
    const errSeed = () => storageStateFor(seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: { p1: v5store([seedNote('n1', 'Note', { text: 'hi' })], 'n1') },
    }));
    const rawOf = (pg) => pg.evaluate((key) => window.localStorage.getItem(key), 'grafnot-store-p1');
    await check('P30 chunk abort shows reload fallback', async () => {
      const ectx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: errSeed() });
      const ep = await ectx.newPage();
      attachErrorGuards(ep);
      try {
        await ep.goto(URL, { waitUntil: 'networkidle' });
        const before = await rawOf(ep);
        await ep.route('**/HomePage-*.js', (route) => route.abort());
        await ep.reload({ waitUntil: 'networkidle' });
        await ep.locator('.g-error').waitFor();
        assert((await ep.locator('.g-error').innerText()).includes('Перезагрузить'), 'no reload button');
        assert((await rawOf(ep)) === before, 'raw changed on crash');
        await ep.unrouteAll();
        await ep.getByRole('button', { name: 'Перезагрузить', exact: true }).click();
        await ep.locator('.tiptap').waitFor();
      } finally {
        await ep.close();
        await ectx.close();
      }
    });
    await check('P30 chunk throw keeps data, export works', async () => {
      const ectx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: errSeed() });
      const ep = await ectx.newPage();
      attachErrorGuards(ep);
      try {
        await ep.goto(URL, { waitUntil: 'networkidle' });
        const before = await rawOf(ep);
        await ep.route('**/HomePage-*.js', (route) => route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'throw new Error("chunk-crash-probe");',
        }));
        await ep.reload({ waitUntil: 'networkidle' });
        await ep.locator('.g-error').waitFor();
        assert((await rawOf(ep)) === before, 'raw changed on crash');
        const [dl] = await Promise.all([
          ep.waitForEvent('download', { timeout: 15000 }),
          ep.getByRole('button', { name: 'Скачать raw JSON' }).click(),
        ]);
        assert((await dl.suggestedFilename()).endsWith('.json'), 'bad export');
        await ep.unrouteAll();
        await ep.getByRole('button', { name: 'Перезагрузить', exact: true }).click();
        await ep.locator('.tiptap').waitFor();
      } finally {
        await ep.close();
        await ectx.close();
      }
    });
  }

  // ---------- GROUP G14-savefail: honest save status (STAGE 06) ----------
  if (await groupActive('G14-savefail')) {
    const failSeed = () => seedProfiles({
      profiles: [{ id: 'f1', name: 'Основной', created: 1 }],
      activeId: 'f1',
      stores: { f1: v5store([seedNote('n1', 'Fail me', { text: 'x' })], 'n1') },
    });
    const openFailNote = async () => {
      await page.getByTestId('nav-home').click();
      await page.locator('.g-noterow', { hasText: 'Fail me' }).first().locator('.g-noteopen').click();
      await page.locator('.g-title-in').waitFor();
    };
    const stubQuota = () => page.evaluate(() => {
      const orig = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (k, v) => {
        if (String(k).startsWith('grafnot-store-')) throw new Error('quota');
        return orig(k, v);
      };
    });
    const failOneEdit = async (title) => {
      await page.locator('.g-title-in').fill(title);
      await page.locator('.g-title-in').press('Enter');
      await page.locator('.g-banner[role="alert"]', { hasText: 'НЕ сохранено' }).waitFor({ timeout: 8000 });
    };
    await check('P31 failed save shows banner and retries', async () => {
      await reseed(page, failSeed());
      await openFailNote();
      await stubQuota();
      await failOneEdit('Fail me edited');
      assert((await page.locator('.g-status').innerText()).includes('НЕ сохранено'), 'header lies');
      await page.evaluate(() => {
        delete window.localStorage.setItem;
      });
      await page.getByRole('button', { name: 'Повторить', exact: true }).click();
      await page.locator('.g-banner[role="alert"]').waitFor({ state: 'detached', timeout: 8000 });
      const st = await page.locator('.g-status').innerText();
      assert(!st.includes('НЕ сохранено'), 'still failed');
      const raw = await page.evaluate(() => window.localStorage.getItem('grafnot-store-f1'));
      assert((raw || '').includes('Fail me edited'), 'edit lost');
    });
    await check('P31 blocked switch keeps profile', async () => {
      await reseed(page, failSeed());
      await openFailNote();
      await stubQuota();
      await failOneEdit('Fail me edited');
      await page.getByTestId('nav-settings').click();
      await page.locator('.g-modal').waitFor();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      assert((await page.locator('[data-testid="profile-picker"]').count()) === 0, 'switched despite failure');
      assert((await page.locator('.g-title-in').inputValue()).includes('Fail me edited'), 'left the profile');
      assert((await page.locator('.g-banner[role="alert"]').count()) > 0, 'no failed banner');
      await page.locator('.g-modal').getByRole('button', { name: 'Всё равно перейти', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    });
  }

  // ---------- GROUP G15-twotab: two writers never lose data silently (STAGE 07) ----------
  // Both tabs open their notes first (activeId-only writes harmonize, they
  // never conflict). Then one tab writes through the UI and waits; the other
  // dirties its note; a script-fast external touch lands inside its debounce
  // window (a sync engine writes at machine speed too). The dirty tab must go
  // loud (conflict), never silent. Order pinned by awaits, no wall-clock race.
  if (await groupActive('G15-twotab')) {
    const twoSeed = () => seedProfiles({
      profiles: [{ id: 'f1', name: 'Основной', created: 1 }],
      activeId: 'f1',
      stores: { f1: v5store([seedNote('a1', 'Note-1'), seedNote('b1', 'Note-2')], 'a1') },
    });
    const openByTitle = async (pg, title) => {
      await pg.getByTestId('nav-home').click();
      await pg.locator('.g-noterow', { hasText: title }).first().locator('.g-noteopen').click();
      await pg.locator('.g-title-in').waitFor();
    };
    const rawHas = (pg, s) => pg.evaluate(
      (needle) => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).map((k) => window.localStorage.getItem(k)).join('').includes(needle),
      s,
    );
    // Script-speed external write in the tab's context (bumps an untouched field).
    const externalTouch = (pg) => pg.evaluate(() => {
      const key = Object.keys(window.localStorage).find((k) => k.startsWith('grafnot-store-'));
      const s = JSON.parse(window.localStorage.getItem(key));
      s.notes[0].updated = Date.now();
      window.localStorage.setItem(key, JSON.stringify(s));
    });
    await check('P32 tab2 edit held on external write', async () => {
      await reseed(page, twoSeed());
      const t2 = await openSecondTab(ctx);
      await t2.goto(URL, { waitUntil: 'networkidle' });
      try {
        await page.bringToFront();
        await openByTitle(page, 'Note-1');
        await t2.bringToFront();
        await openByTitle(t2, 'Note-2');
        await page.bringToFront();
        await page.locator('.g-title-in').fill('A-note');
        await page.locator('.g-title-in').press('Enter');
        await page.waitForFunction(
          (needle) => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).map((k) => window.localStorage.getItem(k)).join('').includes(needle),
          'A-note', { timeout: 8000 },
        );
        await t2.bringToFront();
        await t2.locator('.g-title-in').fill('B-edit');
        await t2.locator('.g-title-in').press('Enter');
        await externalTouch(page);
        // Past the debounce window: tab2 must have refused the write loudly.
        await page.waitForTimeout(800);
        assert((await t2.locator('.g-banner[role="alert"]', { hasText: 'Конфликт' }).count()) > 0, 'no conflict, silent drop?');
        assert(await rawHas(page, 'A-note'), 'tab1 note lost');
        assert(!(await rawHas(page, 'B-edit')), 'tab2 edit written over newer storage');
      } finally {
        await t2.close();
      }
    });
    await check('P32 tab1 edit held on external write', async () => {
      await reseed(page, twoSeed());
      const t2 = await openSecondTab(ctx);
      await t2.goto(URL, { waitUntil: 'networkidle' });
      try {
        await t2.bringToFront();
        await openByTitle(t2, 'Note-2');
        await page.bringToFront();
        await openByTitle(page, 'Note-1');
        await t2.bringToFront();
        await t2.locator('.g-title-in').fill('B-edit');
        await t2.locator('.g-title-in').press('Enter');
        await t2.waitForFunction(
          (needle) => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).map((k) => window.localStorage.getItem(k)).join('').includes(needle),
          'B-edit', { timeout: 8000 },
        );
        await page.bringToFront();
        await page.locator('.g-title-in').fill('A-note');
        await page.locator('.g-title-in').press('Enter');
        await externalTouch(t2);
        await page.waitForTimeout(800);
        assert((await page.locator('.g-banner[role="alert"]', { hasText: 'Конфликт' }).count()) > 0, 'no conflict, silent drop?');
        assert(await rawHas(page, 'B-edit'), 'tab2 note lost');
        assert(!(await rawHas(page, 'A-note')), 'tab1 edit written over newer storage');
      } finally {
        await t2.close();
      }
    });
  }

  // ---------- GROUP G16-registry: corrupt registry never loses stores (STAGE 08) ----------
  // An invalid element poisons the whole registry: boot backs it up, rebuilds
  // from store keys (generated names), and never adopts a random default over
  // the data. Both profiles stay enterable, notes intact.
  if (await groupActive('G16-registry')) {
    const regStores = () => ({
      f1: v5store([seedNote('a1', 'Note-A')], 'a1'),
      f2: v5store([seedNote('b1', 'Note-B')], 'b1'),
    });
    const storeKeys = () => page.evaluate(
      () => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).sort(),
    );
    const backToPicker = async () => {
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    };
    await check('P33 invalid entry recovers every profile from keys', async () => {
      await reseed(page, seedProfiles({
        profiles: [
          { id: 'f1', name: 'Основной', created: 1 },
          { id: 7, name: 'X' },
          { id: 'f2', name: 'Второй', created: 2 },
        ],
        activeId: 'f1',
        stores: regStores(),
      }));
      await page.locator('.g-toasts', { hasText: 'восстановлен' }).waitFor();
      await page.locator('[data-testid="profile-picker"]').waitFor();
      assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'not both recovered');
      const reg = await page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')));
      assert(reg.profiles.map((p) => p.id).join(',') === 'f1,f2', 'ids lost: ' + JSON.stringify(reg));
      assert((await storeKeys()).join(',') === 'grafnot-store-f1,grafnot-store-f2', 'extra keys adopted');
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 1' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-home').click();
      await page.locator('.g-noterow', { hasText: 'Note-A' }).waitFor();
      await backToPicker();
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 2' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-home').click();
      await page.locator('.g-noterow', { hasText: 'Note-B' }).waitFor();
    });
    await check('P33 broken registry recovers profiles and keeps a backup', async () => {
      await reseed(page, seedProfiles({ profiles: '{oops', activeId: '', stores: regStores() }));
      await page.locator('.g-toasts', { hasText: 'восстановлен' }).waitFor();
      await page.locator('[data-testid="profile-picker"]').waitFor();
      assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'not both recovered');
      const kept = await page.evaluate(() => {
        const bks = Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-profiles-v1:corrupt-'));
        return { n: bks.length, raw: bks.length > 0 ? window.localStorage.getItem(bks[0]) : null };
      });
      assert(kept.n === 1 && kept.raw === '{oops', 'backup missing: ' + JSON.stringify(kept));
      assert((await storeKeys()).join(',') === 'grafnot-store-f1,grafnot-store-f2', 'extra keys adopted');
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 2' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-home').click();
      await page.locator('.g-noterow', { hasText: 'Note-B' }).waitFor();
    });
  }

  // ---------- GROUP G17-adoption: legacy adoption never loses data silently (STAGE 09) ----------
  // Quota stub: init script below, armed only by a 'grafnot-quota-stub' seed
  // flag. Profile-store and registry writes throw a real QuotaExceededError;
  // the legacy original and the flag stay writable.
  if (await groupActive('G17-adoption')) {
    const backToPicker = async () => {
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    };
    const adoptionState = () => page.evaluate(() => ({
      reg: window.localStorage.getItem('grafnot-profiles-v1'),
      legacy: window.localStorage.getItem('grafnot-store-v2'),
      stores: Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).sort(),
    }));
    await check('P34 adoption quota fails loud, keeps legacy, grows nothing', async () => {
      const big = 'x'.repeat(20000);
      await reseed(page, Object.assign(
        seedLegacy({ notes: [seedNote('o1', 'Old-big', { text: big })], tasks: [], activeId: 'o1' }),
        { 'grafnot-quota-stub': '1' },
      ));
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      assert((await page.locator('[data-testid="adoption-blocked"]').innerText()).includes('перенести'), 'wrong screen');
      let st = await adoptionState();
      assert(st.reg === null, 'registry saved despite quota');
      assert(st.legacy !== null && st.legacy.includes('Old-big'), 'legacy damaged');
      assert(st.stores.join(',') === 'grafnot-store-v2', 'keys grew: ' + st.stores.join(','));
      // Reload: still blocked, still no registry, key count stable.
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      st = await adoptionState();
      assert(st.reg === null && st.stores.join(',') === 'grafnot-store-v2', 'reload created keys: ' + JSON.stringify(st));
      // Start-empty cannot save the registry either: loud toast, stay blocked.
      await page.getByRole('button', { name: 'Начать с пустого профиля' }).click();
      await page.getByRole('button', { name: 'Точно? Начать с пустого' }).click();
      await page.locator('.g-toasts', { hasText: 'реестр' }).waitFor({ timeout: 8000 });
      st = await adoptionState();
      assert(st.reg === null, 'phantom registry saved');
      assert((await page.locator('[data-testid="adoption-blocked"]').count()) === 1, 'left blocked screen');
    });
    await check('P35 corrupt legacy waits for choice, start-empty keeps it', async () => {
      await reseed(page, seedLegacy('{oops'));
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      assert((await page.locator('[data-testid="adoption-blocked"]').innerText()).includes('не читаются'), 'wrong screen');
      assert((await page.getByRole('button', { name: 'Повторить' }).count()) === 0, 'retry on unreadable data');
      let st = await adoptionState();
      assert(st.reg === null && st.legacy === '{oops', 'state moved: ' + JSON.stringify(st));
      await page.getByRole('button', { name: 'Начать с пустого профиля' }).click();
      await page.getByRole('button', { name: 'Точно? Начать с пустого' }).click();
      await page.locator('.g-empty-t').waitFor();
      // Registry only on explicit choice; the legacy original stays.
      st = await adoptionState();
      assert(st.reg !== null && st.legacy === '{oops', 'legacy eaten: ' + JSON.stringify(st));
      // Picker re-offers the stranded legacy instead of stranding it.
      await backToPicker();
      await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).waitFor();
      // Import of still-unreadable data fails loud, registry untouched.
      await page.getByRole('button', { name: 'Импортировать как профиль' }).click();
      await page.getByRole('button', { name: 'Точно? Импортировать' }).click();
      await page.locator('.g-toasts', { hasText: 'операцию' }).waitFor({ timeout: 8000 });
      st = await adoptionState();
      assert(JSON.parse(st.reg).profiles.length === 1 && st.legacy === '{oops', 'import half-ran: ' + JSON.stringify(st));
    });
    await check('P36 valid legacy imports as a new verified profile', async () => {
      await reseed(page, Object.assign(
        seedProfiles({
          profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
          activeId: 'p1',
          stores: { p1: v5store([seedNote('e1', 'Existing')], 'e1') },
        }),
        seedLegacy({ notes: [seedNote('l1', 'Legacy-note')], tasks: [], activeId: 'l1' }),
      ));
      await backToPicker();
      await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).waitFor();
      await page.getByRole('button', { name: 'Импортировать как профиль' }).click();
      await page.getByRole('button', { name: 'Точно? Импортировать' }).click();
      await page.getByTestId('nav-home').click();
      await page.locator('.g-noterow', { hasText: 'Legacy-note' }).waitFor();
      const st = await adoptionState();
      assert(st.legacy === null, 'legacy left behind');
      assert(JSON.parse(st.reg).profiles.length === 2, 'registry wrong: ' + st.reg);
      assert((await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).count()) === 0, 'banner stuck');
    });
  }

  } finally {
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
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});

