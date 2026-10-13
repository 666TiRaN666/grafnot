const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const URL = 'http://localhost:5199/';
const EXE = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// How many checks run below. Update together when adding checks.
const EXPECTED_CHECKS = 164;

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
const GROUP_FILTER = (process.env.GROUPS || '').split(',').map((s) => s.trim()).filter(Boolean);
let currentGroup = '';
let mainPage = null;
// Per-group check counts. Update together with EXPECTED_CHECKS when adding checks.
const GROUP_SIZES = {
  'G0-boot': 3, 'G1-adopt-clean': 1, 'G2-editor': 9, 'G3-linkcalc': 6,
  'G4-story': 20, 'G5-prompt': 6, 'G6-tasks': 7, 'G7-lists': 3,
  'G8-mobile': 1, 'G9-profiles': 5, 'G10-p27': 5, 'G11-selftest': 1, 'G12-blocked': 3, 'G13-error': 2, 'G14-savefail': 2, 'G15-twotab': 2,   'G16-registry': 2, 'G17-adoption': 3, 'G18-shell': 6, 'G19-notes': 7, 'G20-plan': 6, 'G21-week': 6, 'G22-lib': 5, 'G23-wb': 8, 'G24-img': 6, 'G25-builder': 6, 'G26-map': 5, 'G27-mob': 6, 'G28-keys': 15, 'G29-kpi': 7,
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
// Seed BEFORE app launch: stage the seed, drop any deep-link hash (reload
// preserves it, and every check navigates explicitly), reload, init script
// applies the seed.
async function reseed(pg, seed) {
  await pg.evaluate((s) => window.localStorage.setItem('grafnot-seed-next', JSON.stringify(s)), seed);
  await pg.evaluate(() => {
    window.location.hash = '';
  });
  await pg.reload({ waitUntil: 'networkidle' });
  const err = await pg.evaluate(() => window.localStorage.getItem('grafnot-seed-error'));
  if (err) throw new Error('seed apply failed: ' + err);
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
    const location = String(e.stack || '').split('\n').find((line) => line.includes('check6.cjs'));
    results.push(`FAIL ${name}: ${String(e.message || e).split('\n')[0]} ${location || ''}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
    await page.getByTestId('palette').waitFor();
    await page.getByTestId('palette-input').fill('zzz-no-such-thing');
    const t = await page.getByTestId('palette').innerText();
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
    // S3: the one-letter toolbar is gone; bold lives in the selection menu,
    // undo on the keyboard.
    await page.keyboard.press('Control+z');
    const html2 = await page.locator('.tiptap').innerHTML();
    assert(!html2.includes('<strong>'), 'undo did not revert');
  });
  await check('P6 title Alpha', async () => {
    await page.locator('.g-title-in').fill('Alpha');
  });

  // ---------- P1: tasks separate + noteId (S4: filed at once, no dialog) ----------
  await check('P1 task from selection filed with note', async () => {
    await page.locator('.tiptap p').click();
    await page.waitForFunction(() => !!document.activeElement?.classList?.contains('tiptap'), null, { timeout: 8000 });
    await page.keyboard.press('Control+a');
    await page.getByTitle('+ Задача').click();
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.getByTestId('ctx-tab-tasks').click();
    await page.locator('.g-note-tasks').waitFor();
    const t = await page.locator('.g-note-tasks').innerText();
    assert(t.includes('(1)') && t.includes('Hi'), 'task not filed: ' + t.slice(0, 120));
  });
  await check('P1b edit task desc in panel', async () => {
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'Hi' }).click();
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-desc').fill('mydesc2');
    await page.keyboard.press('Tab');
    const row = page.locator('.g-taskline', { hasText: 'Hi' });
    await row.waitFor();
    assert((await row.innerText()).includes('mydesc2'), 'desc missing');
  });
  await check('P1 chip back to note', async () => {
    await page.getByTestId('nav-plan').click();
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
    await page.getByTestId('nav-plan').click();
    // S4: vertical composer; the date picker hides behind «Выбрать дату…».
    await page.getByTestId('task-composer').click();
    await page.locator('.g-addtask input').first().fill('Cal task');
    await page.getByRole('button', { name: /Выбрать дату|Pick a date|Күнді/ }).click();
    await page.locator('.g-addtask input[type="date"]').fill(todayISO);
    await page.getByRole('button', { name: 'Добавить' }).click();
    await page.locator('.g-taskline', { hasText: 'Cal task' }).waitFor();
  });
  await check('P2 week grid + toggle', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    assert((await page.locator('.g-day').count()) === 7, 'not 7 days');
    await page.locator('.g-taskchip', { hasText: 'Cal task' }).waitFor();
    const firstBefore = await page.locator('.g-day-head strong').first().innerText();
    await page.getByLabel('›').click();
    const firstAfter = await page.locator('.g-day-head strong').first().innerText();
    assert(firstBefore !== firstAfter, 'week nav did not move');
    await page.getByLabel('‹').click();
    const chip = page.locator('.g-taskchip', { hasText: 'Cal task' });
    // S5: the chip opens the panel; only its checkbox toggles done.
    await chip.locator('xpath=..').locator('input[type="checkbox"]').click();
    assert((await chip.getAttribute('class'))?.includes('done') ?? false, 'toggle failed');
  });
  await check('P2 undated section', async () => {
    const sec = page.getByTestId('week-inbox');
    await sec.waitFor();
    assert((await sec.innerText()).includes('Hi'), 'undated task missing');
  });

  // ---------- GROUP G3-linkcalc: links + calculations (Alpha note) ----------
  await beginGroup('G3-linkcalc', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('a1', 'Alpha')], 'a1') },
  }));

  // ---------- P3: [[ mention links without a dialog (S3) ----------
  await check('P3 link Beta to Alpha', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Beta');
    await page.locator('.tiptap').click();
    await page.keyboard.type('[[Alpha');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).waitFor();
  });
  await check('P3 unlink offers undo', async () => {
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).locator('.g-unlink').click();
    assert((await page.locator('.g-unlink').count()) === 0, 'link not removed');
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).waitFor();
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
    await page.locator('svg.g-canvas').waitFor();
    // S10: no lock anymore (MAP_UNLOCK=0); an unlinked canvas shows guidance.
    assert((await page.getByTestId('map-view').innerText()).includes('Соедините заметки'), 'no empty hint');
    await reseed(page, storyGrownLegacy());
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    const t = await page.getByTestId('map-view').innerText();
    assert(!t.includes('128'), 'fake count present');
    assert(t.includes('(' + (MAP_UNLOCK + 1) + ')'), `real count missing: ${t.slice(0, 200)}`);
    assert((await page.getByTestId('map-orphans').innerText()).includes('(' + (MAP_UNLOCK + 1) + ')'), 'unlinked wrong');
  });
  await check('P7 similar real', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    await page.locator('.g-right').waitFor();
    await page.getByTestId('ctx-tab-similar').click();
    const t = await page.locator('.g-right').innerText();
    assert(t.includes('Alpha'), 'real similar missing');
    assert(!t.includes('Normalization'), 'fake similar present');
  });
  await check('P7 broken flow', async () => {
    await page.locator('.tiptap').click();
    await page.keyboard.type('[[Alpha');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('ctx-tab-links').click();
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).locator('.g-linkbtn').click();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    assert((await page.locator('.g-brokenrow').count()) === 0, 'dangling refs remain');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-card', { hasText: 'Связанное' }).locator('li').count()) === 0, 'refs not purged');
  });
  await check('P7 rename propagation', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Delta');
    await page.locator('.tiptap').click();
    await page.keyboard.type('[[Beta');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await pickViaPalette(page, 'Beta', 'Beta');
    await page.locator('.g-title-in').fill('Gamma');
    await page.keyboard.press('Enter');
    await pickViaPalette(page, 'Delta', 'Delta');
    await page.getByTestId('ctx-tab-links').click();
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Gamma') && !t.includes('Beta'), `refs not updated: ${t}`);
  });
  await check('P7 unique titles', async () => {
    await newViaPalette(page);
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
    await page.locator('.s-rail').getByLabel('Меню').click();
    await page.locator('.s-rail.collapsed').waitFor();
    assert((await page.locator('.s-rail .s-navlbl').count()) === 0, 'labels visible in rail');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.s-rail.collapsed').waitFor();
  });
  await check('P9 create from rail', async () => {
    await page.getByTestId('quickadd').click();
    await page.getByTestId('palette').waitFor();
    await page.getByTestId('palette').getByRole('button', { name: '+ Новая заметка' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('.s-rail').getByLabel('Меню').click();
    assert((await page.locator('.s-rail.collapsed').count()) === 0, 'not expanded');
  });
  await check('P9 center capped', async () => {
    const mw = await page.evaluate(() => getComputedStyle(document.querySelector('.n-editor')).maxWidth);
    assert(mw === '860px', `maxWidth ${mw}`);
  });


  await check('P10 right collapse + Alt+0', async () => {
    await page.getByLabel('Правая панель').click();
    await page.locator('.g-rail-r').waitFor();
    assert((await page.locator('.g-right').count()) === 0, 'right still visible');
    await page.locator('.s-rail').getByLabel('Меню').click();
    await page.keyboard.press('Alt+0');
    assert((await page.locator('.s-rail.collapsed').count()) === 0, 'sidebar not reset');
    assert((await page.locator('.g-rail-r').count()) === 0, 'right not reset');
    assert((await page.locator('.g-right').count()) === 1, 'right not open');
  });


  await check('P11 notes list open+delete', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    assert((await page.locator('.g-noterow').count()) >= 3, 'few rows');
    await page.locator('.g-noterow', { hasText: 'Gamma' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-title-in').inputValue()) === 'Gamma', 'not opened');
  });
  await check('P11 backlinks both ways', async () => {
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Delta'), `no incoming: ${t}`);
  });
  await check('P11 delete Seed 20 with undo', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-notes-tools .g-in').fill('Seed 20');
    await page.locator('.g-noterow', { hasText: 'Seed 20' }).first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    // S3: no arm-delete in the list; the ⋯ menu deletes at once with Undo.
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.locator('.g-toast-undo').waitFor();
    // Exact title match: a substring assert would also hit 'Seed 2'+date.
    assert((await page.locator('.g-noteopen', { hasText: /^Seed 20$/ }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('.g-noteopen', { hasText: /^Seed 20$/ }).waitFor();
  });


  await check('P12 graph create+rename', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: '+ Новый' }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await page.locator('.g-gtitle-in').fill('Math');
    await page.keyboard.press('Enter');
    assert((await page.getByTestId('map-graphs').innerText()).includes('Math'), 'no Math tab');
  });
  await check('P12 assign isolates nodes', async () => {
    const st = async (n, f) => { try { await f(); } catch (e) { throw new Error(n + ' :: ' + String(e).split('\n')[0]); } };
    await st('open-members', async () => {
      await page.getByTestId('map-menu').click();
      await page.getByRole('menuitem', { name: 'Состав' }).click();
      await page.getByTestId('map-members').waitFor({ timeout: 8000 });
    });
    await st('check-gamma', async () => {
      await page.locator('.g-memberrow', { hasText: 'Gamma' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('check-delta', async () => {
      await page.locator('.g-memberrow', { hasText: 'Delta' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('close-drawer', async () => {
      await page.keyboard.press('Escape');
      await page.getByTestId('map-members').waitFor({ state: 'detached', timeout: 8000 });
    });
    assert((await page.locator('circle.g-vnode').count()) === 2, 'not isolated');
    assert((await page.locator('line.g-vedge').count()) >= 1, 'no edges in Math');
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /HCI/ }).click();
    const hci = await page.locator('circle.g-vnode').count();
    assert(hci > 2, `HCI small: ${hci}`);
  });
  await check('P12 zoom+drag', async () => {
    const before = await page.locator('g.g-view').getAttribute('transform');
    await page.getByLabel('Приблизить').click();
    const after = await page.locator('g.g-view').getAttribute('transform');
    assert(before !== after && (after || '').includes('1.25'), `no zoom: ${after}`);
    // Drag the node farthest from the canvas center toward it: edge nodes
    // plus an outward vector would leave the viewport and drop the gesture.
    // Only fully visible nodes qualify (outside the svg the press lands on
    // the shell; under the floating toolbar it lands on the toolbar).
    const grab = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let best = null;
      for (const c of svg.querySelectorAll('circle.g-vnode')) {
        const b = c.getBoundingClientRect();
        const x = b.left + b.width / 2;
        const y = b.top + b.height / 2;
        if (x < r.left + 30 || x > r.right - 30 || y < r.top + 30 || y > r.bottom - 110) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d > best.d) best = { id: c.getAttribute('data-id'), x, y, d };
      }
      return { node: best, center: { x: cx, y: cy } };
    });
    assert(!!grab.node && grab.node.d > 4, 'no draggable node');
    const c0 = page.locator(`circle.g-vnode[data-id="${grab.node.id}"]`);
    const cx0 = await c0.getAttribute('cx');
    await page.mouse.move(grab.node.x, grab.node.y);
    await page.mouse.down();
    await page.mouse.move(grab.center.x, grab.center.y, { steps: 8 });
    await page.mouse.up();
    const cx1 = await c0.getAttribute('cx');
    assert(cx0 !== cx1, 'drag did not move');
  });

  await check('P12 hit zone r24', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Math/ }).click();
    // The scope switch resets pan/zoom asynchronously (canvas view effect):
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
    // S10: node clicks open the peek drawer (preview cards deleted).
    await page.getByTestId('map-peek').waitFor();
    const sel = await page.getByTestId('map-peek').innerText();
    assert(sel.includes('Gamma') || sel.includes('Delta'), `wrong selection: ${sel.slice(0, 80)}`);
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
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: '+ Новый' }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    const countUngrouped = async () => {
      await page.getByTestId('map-graphs').click();
      const t = await page.getByTestId('map-graphs-pop').innerText();
      await page.keyboard.press('Escape');
      const m = /Без графа \((\d+)\)/.exec(t);
      return m ? Number(m[1]) : -1;
    };
    const before = await countUngrouped();
    await newViaPalette(page);
    await page.getByTestId('nav-map').click();
    assert((await countUngrouped()) === before + 1, 'new note not ungrouped');
  });

  await check('P12 delete keeps notes', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Math/ }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    const before = await page.locator('.g-noterow').count();
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Math/ }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    const after = await page.locator('.g-noterow').count();
    assert(before === after && before > 0, `notes lost: ${before} vs ${after}`);
  });


  // ---------- GROUP G5-prompt: prompt page on an empty store ----------
  await beginGroup('G5-prompt', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], '') },
  }));

  await check('P13 template builder creates edits deletes', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').getByRole('button', { name: '+ Новый шаблон' }).click();
    await page.getByTestId('prompt-builder').waitFor();
    const templateName = 'Blue eyes template';
    await page.getByTestId('builder-name').fill(templateName);
    await page.getByTestId('builder-body').fill('blue eyes and {{style}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ct'), null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).waitFor();
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Изменить' }).click();
    await page.getByTestId('prompt-builder').waitFor();
    assert((await page.getByTestId('builder-name').inputValue()) === templateName, 'template is not editable');
    await page.getByTestId('builder-body').fill('blue hair and {{style}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="prompt-result"]') || {}).innerText?.includes('blue hair'), null, { timeout: 8000 });
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).count()) === 0, 'template not deleted');
  });
  await check('P13 llm template save', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').fill('sql');
    assert((await page.locator('[data-testid="prompt-item"]').count()) === 1, 'search must narrow rows');
    await page.getByTestId('prompt-search').fill('');
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('x');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).waitFor();
  });


  await check('P13b bind to note + open + unbind', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Prompthost');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).filter({ hasText: 'Встроенный' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('probe');
    await page.getByRole('button', { name: /В заметку/ }).click();
    await page.locator('[data-testid^="w-note-pick-"]', { hasText: 'Prompthost' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'Prompthost' }).first().locator('.g-noteopen').click();
    await page.getByTestId('ctx-tab-prompts').click();
    const card = page.locator('.g-card', { hasText: 'Промпты' });
    await card.waitFor();
    assert((await card.innerText()).includes('Code review'), 'not linked');
    await card.getByRole('button', { name: 'Открыть' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Code review'), 'linked save did not open');
    await pickViaPalette(page, 'Prompthost');
    await page.getByTestId('ctx-tab-prompts').click();
    await page.locator('.g-card', { hasText: 'Промпты' }).getByRole('button', { name: 'Отвязать' }).click();
    assert((await page.locator('.g-card', { hasText: 'Промпты' }).innerText()).includes('Нет привязанных'), 'not unbound');
  });


  await check('P13c keyboard picks tag', async () => {
    await page.getByTestId('nav-prompt').click();
    assert((await page.getByTestId('prompt-library').innerText()).includes('1.0.0-sample'), 'no dataset version');
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByTestId('tag-input').fill('blue');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).waitFor();
  });


  await check('P13d syntax per model + inline risk', async () => {
    const lastBody = () => page.evaluate(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls.slice(-1)[0] || {}).body || '');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByTestId('tag-input').fill('blue skin');
    const risk = await page.locator('[data-testid^="tag-suggest-item-"]', { hasText: 'blue skin' }).innerText();
    assert(risk.includes('%'), `risk rate missing: ${risk.slice(0, 80)}`);
    await page.getByTestId('tag-input').fill('blue');
    await page.locator('[data-testid^="tag-suggest-item-"]').first().waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).waitFor();
    await page.getByRole('button', { name: 'SDXL', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'blue hair (SDXL)' }).waitFor();
    await page.waitForFunction(() => ((JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => (t.body || '').includes('(blue'))), null, { timeout: 8000 });
    const sdxlBody = await lastBody();
    assert(sdxlBody.includes('(blue hair)') || sdxlBody.includes('(blue eyes)'), `bad SDXL body: ${sdxlBody.slice(0, 120)}`);
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByRole('button', { name: 'Flux', exact: true }).click();
    await page.getByTestId('tag-input').fill('blue');
    await page.locator('[data-testid^="tag-suggest-item-"]').first().waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue eyes' }).waitFor();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'blue eyes (Flux)' }).waitFor();
    await page.waitForFunction(() => ((JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => (t.body || '').includes('blue eyes'))), null, { timeout: 8000 });
    const fluxBody = await lastBody();
    assert(/blue (hair|eyes)/.test(fluxBody) && !fluxBody.includes('(blue'), `bad Flux body: ${fluxBody.slice(0, 120)}`);
  });

  await check('P14 no cloud sync wording', async () => {
    // The header honestly shows Сохраняется… while a save is armed: let the
    // debounce window settle so the wording assertions read a final state.
    await page.waitForFunction(
      () => !document.querySelector('.g-status')?.textContent?.includes('Сохраняется'),
      null,
      { timeout: 8000 },
    );
    const top = await page.getByTestId('page-header').innerText();
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
    await page.getByTestId('settings-page').waitFor();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).waitFor();
    const t = await page.getByTestId('settings-page').innerText();
    assert(t.includes('Тема') || t.includes('Theme') || t.includes('Тақырып'), `no labels: ${t}`);
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'theme not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'Светлая', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'light', 'theme not reverted');
    // S9: the prompts limit control is gone (N9 batches); lists persist via listPrefs (unit-tested).
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('settings-page').waitFor({ state: 'detached' });
    assert((await page.getByTestId('settings-page').count()) === 0, 'settings page stuck');
  });

    await check('P16 note snippets termed заготовки', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.getByTestId('ctx-tab-snip').click();
    const panel = await page.locator('.g-right').innerText();
    assert(panel.includes('Заготовки'), `no snippets title: ${panel}`);
    assert(!panel.includes('Шаблоны'), 'old term present');
    await page.locator('.g-right').getByRole('button', { name: 'Лекция', exact: true }).click();
    await page.locator('.g-toasts', { hasText: 'Заготовка вставлена' }).waitFor();
    await page.locator('.tiptap', { hasText: 'Лекция' }).waitFor();
  });

    await check('P17a task to trash and restore', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    await page.locator('.g-page input[aria-label="new task"]').fill('TrashProbe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
    // S4: immediate delete with Undo instead of arm-confirm.
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('.g-taskline', { hasText: 'TrashProbe' }).count()) === 0, 'task not trashed');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).waitFor();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).getByRole('button', { name: 'восстановить' }).click();
    assert((await page.locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not restored');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
  });

  await check('P17b purge needs arm confirm', async () => {
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    const trow = page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' });
    await trow.getByRole('button', { name: 'Удалить навсегда' }).click();
    await page.getByRole('alertdialog').waitFor();
    assert((await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 1, 'purged without confirm');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not purged');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    const n0 = await page.getByTestId('settings-page').locator('.g-sugg').count();
    await page.getByTestId('settings-page').locator('.g-sugg').first().getByRole('button', { name: 'Удалить навсегда' }).click();
    await page.getByRole('alertdialog').waitFor();
    assert((await page.getByTestId('settings-page').locator('.g-sugg').count()) === n0, 'note purged without confirm');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.getByTestId('settings-page').locator('.g-sugg').count()) === n0 - 1, 'note not purged');
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
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'Old' }).waitFor();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.muted', { hasText: 'Корзина пуста' }).waitFor();
  });

    await check('P18 ctrl+k finds saved prompt and opens its card', async () => {
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('P18 probe');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).waitFor();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('code review');
    const res = page.locator('[data-testid^="palette-item-"]', { hasText: 'Code review' });
    await res.first().waitFor();
    assert((await page.getByTestId('palette').innerText()).includes('промпт'), 'no prompt kind');
    await res.first().click();
    // S7: template picks land in the workbench, not the legacy card.
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Code review'), 'wrong workbench');
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
    // S9: the migrated template + save surface as library rows (no minis).
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Legacy blue art' }).first().waitFor();
    const saveRow = page.locator('[data-testid="prompt-item"]', { hasText: 'Legacy blue art' }).filter({ hasText: 'Сохранённый' });
    await saveRow.click();
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-result').innerText()).includes('(blue hair)'), 'legacy image syntax lost');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'Legacy note' }).first().locator('.g-noteopen').click();
    await page.getByTestId('ctx-tab-prompts').click();
    const prompts = page.locator('.g-card', { hasText: 'Промпты' });
    await prompts.waitFor();
    assert((await prompts.innerText()).includes('Legacy blue art'), 'legacy note link lost');
  });

  // ---------- GROUP G7-lists: legacy list/search/limit seeds (each check reseeds) ----------
  currentGroup = 'G7-lists';

    await check('P19 notes list N9 search keyboard', async () => {
    await reseed(page, seedLegacy((() => {
      const notes = [];
      for (let i = 1; i <= 12; i++) {
        const n = i < 10 ? '0' + i : '' + i;
        notes.push({ id: 'sn' + i, title: 'Seed Note ' + n, content: '', text: i === 3 ? 'Zebra stripes here' : 'plain body ' + i, linkedIds: [], calcs: [], updated: Date.now() - i * 1000 });
      }
      return { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'sn1' };
    })()));
    await page.getByTestId('nav-notes').click();
    // S3/N9: no limit selector; one batch of 50 with an honest counter.
    assert((await page.locator('.g-noterow').count()) === 12, 'N9 batch broken');
    assert((await page.locator('.g-notes-tools').first().locator('..').innerText()).includes('12 из 12'), 'no shown-of counter');
    await page.locator('.g-notes-tools .g-in').fill('zebra');
    assert((await page.locator('.g-noterow').count()) === 1, 'search must narrow first');
    await page.locator('.g-notes-tools .g-in').fill('');
    assert((await page.locator('.g-noterow').count()) === 12, 'clear must restore batch');
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
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline').first().waitFor();
    // S4/N9: groups instead of filter/limit segs; done collapsed by default.
    assert((await page.getByTestId('task-group-undated').innerText()).includes('(9)'), 'undated group off');
    assert((await page.getByTestId('task-group-done').innerText()).includes('(3)'), 'done group off');
    await page.locator('.g-notes-tools .g-in').fill('login');
    assert((await page.locator('.g-taskline').count()) === 2, 'search must find both');
    await page.locator('.g-notes-tools .g-in').fill('');
    await page.locator('.g-notes-tools .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => (document.querySelector('[data-testid="task-group-undated"]') || {}).innerText?.includes('(8)'), null, { timeout: 8000 });
    assert((await page.getByTestId('task-group-done').innerText()).includes('(4)'), 'toggled task not in done');
    await page.getByTestId('task-group-done').getByRole('button').first().click();
    await page.locator('.g-taskline', { hasText: 'Fix login button' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'Fix login button' }).waitFor();
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
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Состав' }).click();
    await page.getByTestId('map-members').waitFor();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 10, 'members not listed');
    await page.locator('[data-testid="map-members"] .g-seg').getByRole('button', { name: '5', exact: true }).click();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 5, 'member limit broken');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 10, 'member show more broken');
    await page.locator('[data-testid="map-members"] .g-in').fill('Member 03');
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 1, 'member search broken');
    const box = page.locator('[data-testid="map-members"] .g-memberrow input');
    assert((await box.isChecked()) === false, 'already a member');
    await box.check();
    assert((await box.isChecked()) === true, 'checkbox toggle broken');
    await box.uncheck();
    await page.locator('[data-testid="map-members"] .g-in').fill('');
    await page.locator('[data-testid="map-members"] .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const box2 = page.locator('[data-testid="map-members"] .g-memberrow input').nth(1);
    assert((await box2.isChecked()) === true, 'keyboard toggle broken');
  });

  // ---------- GROUP G8-mobile: isolated context, empty storage ----------
  if (await groupActive('G8-mobile')) {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storageStateFor({}) });
    const m = await mctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });

    await check('P22 mobile tabbar direct sections', async () => {
    assert(await m.getByTestId('tabbar').isVisible(), 'no tabbar');
    assert((await m.getByTestId('tabbar').locator('button').count()) === 5, 'not 5 items');
    await m.getByTestId('tab-prompts').click();
    // S9: prompts open the library (legacy page deleted).
    await m.getByTestId('prompt-library').waitFor();
    assert(((await m.getByTestId('tab-prompts').getAttribute('class')) || '').includes('active'), 'prompt tab not active');
    await m.getByTestId('tab-map').click();
    // S10: the map is always open (no lock); empty storage shows guidance.
    await m.locator('.m-map', { hasText: 'Новые заметки' }).waitFor();
    assert((await m.locator('.g-maplocked').count()) === 0, 'lock still present');
    });

    await m.close();
    await mctx.close();
  }

  // ---------- GROUP G9-profiles: avatar, shortcuts, toasts, profiles (empty start) ----------
  await beginGroup('G9-profiles', {});

    await check('P23 settings entry opens settings page', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-page').waitFor();
    assert((await page.locator('.g-modal').count()) === 0, 'settings still modal');
    for (const nav of ['settings-nav-profiles', 'settings-nav-appearance', 'settings-nav-trash', 'settings-nav-keys', 'settings-nav-data']) {
      assert((await page.getByTestId(nav).count()) === 1, 'no ' + nav);
    }
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('settings-page').waitFor({ state: 'detached' });
    assert((await page.getByTestId('settings-page').count()) === 0, 'settings stuck');
  });

    await check('P24 shortcuts help section', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-keys').click();
    const panel = page.getByTestId('settings-page');
    await panel.waitFor();
    const t = await panel.innerText();
    assert(t.includes('Глобальный поиск') && t.includes('Ctrl+K'), 'no search row');
    assert(t.includes('Сбросить панели') && t.includes('Alt+0'), 'no panels row');
    assert(t.includes('Новая заметка') && t.includes('Ctrl+Alt+N'), 'no new note row');
  });

    await check('P25 toast manual close', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
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
    await page.getByTestId('nav-notes').click();
    assert((await page.locator('.g-noterow').count()) === 0, 'second not empty');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'dark not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'EN', exact: true }).click();
    assert((await page.getByTestId('settings-page').innerText()).includes('Settings'), 'lang not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'RU', exact: true }).click();
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'two rows');
    await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Основной' }).getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('nav-notes').click();
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
    await page.getByTestId('nav-notes').click();
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
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'Dup me' }).locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-duplicate').click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value?.includes('Дублировать'), null, { timeout: 8000 });
    await page.waitForFunction(() => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).some((k) => (window.localStorage.getItem(k) || '').includes('Дублировать')), null, { timeout: 8000 });
  });

  await check('P27 export downloads markdown', async () => {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      (async () => {
        await page.getByTestId('notes-more').click();
        await page.getByTestId('notes-menu-export').click();
      })(),
    ]);
    assert((await dl.suggestedFilename()).endsWith('.md'), 'bad filename');
    await page.locator('.g-toasts', { hasText: 'скачан' }).waitFor();
  });

  await check('P27 KZ toggle', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-page').waitFor();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('settings-page').getByRole('button', { name: 'KZ', exact: true }).click();
    assert((await page.getByTestId('settings-page').innerText()).includes('Тақырып'), 'KZ not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'RU', exact: true }).click();
    assert((await page.getByTestId('settings-page').innerText()).includes('Тема'), 'RU not restored');
    await page.getByTestId('nav-notes').click();
  });

  await check('P27 quota fails loud once, never spams', async () => {
    await page.evaluate(() => {
      const orig = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (k, v) => {
        if (String(k).startsWith('grafnot-store-')) throw new Error('quota');
        return orig(k, v);
      };
    });
    await page.getByTestId('nav-notes').click();
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
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-title-in').inputValue()).includes('Дублировать'), 'last-good lost');
  });

    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storageStateFor(seedLegacy({ schemaVersion: 5, notes: [{ id: 'w1', title: 'W1', content: '', text: '', linkedIds: [], calcs: [], updated: 1 }], tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'w1' })) });
    const m = await mctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
  await check('P27 mobile map opens with guidance, no lock', async () => {
    await m.getByTestId('tab-map').click();
    await m.locator('svg.g-canvas').waitFor();
    assert((await m.locator('.g-maplocked').count()) === 0, 'lock still present');
    await m.locator('.m-map', { hasText: 'Соедините заметки' }).waitFor();
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
        await ep.route('**/NotesView-*.js', (route) => route.abort());
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
        await ep.route('**/NotesView-*.js', (route) => route.fulfill({
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
      await page.getByTestId('nav-notes').click();
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
      await page.getByTestId('settings-page').waitFor();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      assert((await page.locator('[data-testid="profile-picker"]').count()) === 0, 'switched despite failure');
      assert((await page.locator('.g-banner[role="alert"]').count()) > 0, 'no failed banner');
      await page.keyboard.press('Escape');
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Fail me' }).first().locator('.g-noteopen').click();
      assert((await page.locator('.g-title-in').inputValue()).includes('Fail me edited'), 'left the profile');
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
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
      await pg.getByTestId('nav-notes').click();
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
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Note-A' }).waitFor();
      await backToPicker();
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 2' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-notes').click();
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
      await page.getByTestId('nav-notes').click();
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
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Legacy-note' }).waitFor();
      const st = await adoptionState();
      assert(st.legacy === null, 'legacy left behind');
      assert(JSON.parse(st.reg).profiles.length === 2, 'registry wrong: ' + st.reg);
      assert((await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).count()) === 0, 'banner stuck');
    });
  }

  // ---------- GROUP G18-shell: S2 frame, palette, settings page ----------
  await beginGroup('G18-shell', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [seedNote('s1', 'PaletteProbe', { text: 'probe body' }), seedNote('s2', 'Second', { text: '' })],
        's1',
        { tasks: [{ id: 't1', text: 'PaletteTask', done: false }] },
      ),
    },
  }));

  await check('S2 four sections one tap', async () => {
    for (const nav of ['nav-notes', 'nav-plan', 'nav-map', 'nav-prompt']) {
      assert((await page.getByTestId(nav).count()) === 1, 'no ' + nav);
    }
    await page.getByTestId('nav-notes').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/notes'), 'no notes hash');
    await page.getByTestId('nav-plan').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/plan'), 'no plan hash');
    await page.getByTestId('nav-prompt').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/prompts'), 'no prompts hash');
    await page.getByTestId('nav-map').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/map'), 'no map hash');
  });

  await check('S2 back forward', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('nav-map').click();
    await page.goBack();
    assert((await page.evaluate(() => window.location.hash)).includes('#/plan'), 'back broken');
    await page.goForward();
    assert((await page.evaluate(() => window.location.hash)).includes('#/map'), 'forward broken');
  });

  await check('S2 ctrl+k palette', async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette').waitFor();
    await page.getByTestId('palette-input').fill('PaletteProbe');
    await page.getByTestId('palette-item-0').waitFor();
    assert((await page.getByTestId('palette-item-0').innerText()).includes('PaletteProbe'), 'no probe hit');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('palette').count()) === 0, 'palette not closed');
  });

  await check('S2 quickadd opens variants', async () => {
    await page.getByTestId('quickadd').click();
    await page.getByTestId('palette').waitFor();
    const t = await page.getByTestId('palette').innerText();
    assert(t.includes('Новая заметка'), 'no new-note command: ' + t.slice(0, 120));
    await page.keyboard.press('Escape');
  });

  await check('S2 settings is page not modal', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-page').waitFor();
    assert((await page.locator('.g-modal').count()) === 0, 'settings still modal');
    assert((await page.evaluate(() => window.location.hash)).includes('#/settings'), 'no settings hash');
  });

  await check('S2 mobile tabbar', async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: storageStateFor(seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: { p1: v5store([seedNote('s1', 'PaletteProbe', { text: '' })], 's1') },
    })) });
    const m = await mctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tabbar').waitFor();
      assert((await m.getByTestId('tabbar').locator('button').count()) === 5, 'not 5 tabbar items');
      await m.getByTestId('tab-notes').click();
      assert((await m.evaluate(() => window.location.hash)).includes('#/notes'), 'tab notes broken');
      await m.getByTestId('tab-add').click();
      await m.getByTestId('palette').waitFor();
    } finally {
      await m.close();
      await mctx.close();
    }
  });

  // ---------- GROUP G19-notes: S3 master-detail, [[ links, selection/slash menus, undo delete ----------
  // Seeded text must live in tiptap `content` (the editor renders content,
  // never the plain-text mirror) for selection-based checks to see it.
  const docPara = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  await beginGroup('G19-notes', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store([
        seedNote('a1', 'Alpha', { text: 'alpha body one two', content: docPara('alpha body one two'), updated: 2 }),
        seedNote('b1', 'Beta', { text: 'beta body three four', content: docPara('beta body three four'), updated: 1 }),
      ], 'a1'),
    },
  }));

  // Editor clicks must settle focus before keys: Playwright does not wait
  // for ProseMirror focus, and keys sent to a button/body vanish silently.
  async function focusEditor() {
    await page.locator('.tiptap').click();
    await page.waitForFunction(() => (document.activeElement || {}).classList?.contains('ProseMirror'), null, { timeout: 8000 });
  }
  // Synthetic key delivery flakes under load (a key rarely lands before the
  // click's caret settles): one re-click retry, then a full wait.
  async function selectAllInEditor() {
    // Selection is the menu's precondition: verify it exists before waiting
    // for the menu, otherwise a lost keypress looks like a product bug.
    for (let attempt = 0; attempt < 3; attempt++) {
      await focusEditor();
      await page.keyboard.press('Control+a');
      try {
        await page.waitForFunction(() => (window.getSelection() || '').toString().length > 0, null, { timeout: 4000 });
        await page.getByTestId('sel-menu').waitFor({ timeout: 8000 });
        return;
      } catch { /* re-click and press again */ }
    }
    await page.getByTestId('sel-menu').waitFor();
  }

  await check('S3 switch one click from editor', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Alpha' }).click();
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-title-in').inputValue()) === 'Alpha', 'Alpha not opened');
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value === 'Beta', null, { timeout: 8000 });
    assert((await page.evaluate(() => window.location.hash)).includes('#/notes/'), 'no note hash');
  });

  await check('S3 bracket suggest links without dialog', async () => {
    await focusEditor();
    await page.keyboard.type('[[Alp');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-right', { hasText: 'Alpha' }).waitFor();
  });

  await check('S3 selection menu bolds', async () => {
    await selectAllInEditor();
    await page.getByTestId('sel-bold').click();
    assert((await page.locator('.tiptap').innerHTML()).includes('<strong>'), 'no bold applied');
  });

  await check('S3 slash menu inserts heading', async () => {
    await focusEditor();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    try {
      await page.getByTestId('slash-menu').waitFor({ timeout: 5000 });
    } catch {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await page.getByTestId('slash-menu').waitFor();
    }
    await page.keyboard.press('Enter');
    assert((await page.locator('.tiptap h3').count()) >= 1, 'no heading inserted');
  });

  await check('S3 more delete undo restores', async () => {
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).waitFor();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value === 'Beta', null, { timeout: 8000 });
  });

  await check('S3 task from selection opens plan from toast', async () => {
    await selectAllInEditor();
    await page.getByTestId('sel-task').click();
    // S4: filed at once, no dialog; the toast opens the planner.
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/plan'), 'toast did not open plan');
  });

  await check('S3 ctx tabs switch panels', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.locator('.g-title-in').waitFor();
    for (const t of ['ctx-tab-links', 'ctx-tab-similar', 'ctx-tab-tasks', 'ctx-tab-prompts', 'ctx-tab-snip']) {
      assert((await page.getByTestId(t).count()) === 1, 'no ' + t);
    }
    await page.getByTestId('ctx-tab-tasks').click();
    await page.locator('.g-note-tasks', { hasText: '(1)' }).waitFor();
  });

  // ---------- GROUP G20-plan: S4 vertical composer, due chips, row panel, undo delete ----------
  await beginGroup('G20-plan', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: (() => {
        const iso = (off) => {
          const d = new Date();
          d.setDate(d.getDate() + off);
          const p = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        const tk = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
        return v5store([], 'p1', { tasks: [
          tk('t1', 'Late bill', { due: iso(-1) }),
          tk('t2', 'Today run', { due: iso(0) }),
          tk('t3', 'Tomorrow call', { due: iso(1) }),
          tk('t4', 'Later dream', { due: iso(10) }),
          tk('t5', 'Free thought'),
          tk('t6', 'Old win', { done: true, due: iso(-2) }),
        ] });
      })(),
    },
  }));
  const tomorrowISO = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });

  await check('S4 composer expands adds keeps focus', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    await page.getByTestId('task-due-today').waitFor();
    await page.getByTestId('task-composer-title').fill('Serial one');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"]', { hasText: 'Serial one' }).waitFor();
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'task-composer-title', 'focus left composer');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('task-due-today').count()) === 0, 'not collapsed');
  });

  await check('S4 N focuses composer', async () => {
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run' }).click();
    await page.getByTestId('task-panel').waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await page.getByTestId('task-due-today').waitFor();
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'task-composer-title', 'N did not focus');
    await page.keyboard.press('Escape');
  });

  await check('S4 due chip tomorrow', async () => {
    await page.getByTestId('task-composer').click();
    await page.getByTestId('task-composer-title').fill('Call mom');
    await page.getByTestId('task-due-tomorrow').click();
    await page.getByTestId('task-add').click();
    const chip = page.locator('[data-testid="task-row"]', { hasText: 'Call mom' }).locator('.g-due');
    await chip.waitFor();
    assert((await chip.getAttribute('title')) === tomorrowISO, 'wrong due stamp');
  });

  await check('S4 row opens panel edits title', async () => {
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run' }).click();
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-title').fill('Today run!');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="task-row"]')].some((r) => (r.textContent || '').includes('Today run!')), null, { timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  await check('S4 delete undo restores', async () => {
    const row = page.locator('[data-testid="task-row"]', { hasText: 'Free thought' });
    await row.getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="task-row"]', { hasText: 'Free thought' }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Free thought' }).waitFor();
  });

  await check('S4 groups overdue first', async () => {
    const first = page.locator('[data-testid^="task-group-"]').first();
    await first.waitFor();
    const head = await first.innerText();
    assert(head.includes('1'), 'no overdue count: ' + head.slice(0, 80));
    const lateRow = page.locator('[data-testid="task-row"]', { hasText: 'Late bill' });
    assert(((await lateRow.innerText()).match(/Просрочено|Overdue|Мерзімі/) || [])[0], 'no overdue text marker');
  });

  // ---------- GROUP G21-week: S5 day cells, popup, chips, drag, inbox ----------
  await beginGroup('G21-week', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: (() => {
        const iso = (off) => {
          const d = new Date();
          d.setDate(d.getDate() + off);
          const p = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        const tk = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
        return v5store([], 'p1', { tasks: [
          tk('w1', 'Inbox item'),
          tk('w2', 'Today item', { due: iso(0) }),
          tk('w3', 'Tomorrow item', { due: iso(1) }),
        ] });
      })(),
    },
  }));
  const weekISO = async (off) => page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, off);

  await check('S5 cell add opens popup focused', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const iso = await weekISO(1);
    await page.getByTestId(`day-cell-${iso}`).waitFor();
    // The whole empty cell area opens the popup; the pinned strip (revealed
    // on hover/focus, always on touch) is the deterministic click target.
    await page.getByTestId(`day-cell-${iso}`).hover();
    await page.getByTestId(`day-add-${iso}`).click();
    await page.getByTestId('day-popup').waitFor();
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'day-popup-title', 'title not focused');
  });

  await check('S5 popup enter adds keeps open', async () => {
    await page.getByTestId('day-popup-title').fill('Series task');
    await page.keyboard.press('Enter');
    await page.locator('.g-taskchip', { hasText: 'Series task' }).waitFor();
    assert((await page.getByTestId('day-popup').count()) === 1, 'popup closed after add');
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'day-popup-title', 'focus left popup');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('day-popup').count()) === 0, 'popup not closed');
  });

  await check('S5 chip opens panel', async () => {
    await page.locator('.g-taskchip', { hasText: 'Today item' }).click();
    await page.getByTestId('task-panel').waitFor();
    assert((await page.getByTestId('task-panel-title').inputValue()) === 'Today item', 'wrong task in panel');
    await page.getByTestId('task-panel-close').click();
  });

  await check('S5 drag moves task with undo', async () => {
    const chip = page.locator('.g-taskchip', { hasText: 'Today item' });
    await chip.waitFor();
    const from = await chip.boundingBox();
    const targetISO = await weekISO(2);
    const cell = page.getByTestId(`day-cell-${targetISO}`);
    await cell.waitFor();
    const to = await cell.boundingBox();
    assert(!!from && !!to, 'no geometry');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.locator(`[data-testid="day-cell-${targetISO}"] .g-taskchip`, { hasText: 'Today item' }).waitFor();
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    const backISO = await weekISO(0);
    await page.locator(`[data-testid="day-cell-${backISO}"] .g-taskchip`, { hasText: 'Today item' }).waitFor();
  });

  await check('S5 inbox shows undated', async () => {
    await page.getByTestId('week-inbox').waitFor();
    assert((await page.getByTestId('week-inbox').innerText()).includes('Inbox item'), 'undated not in inbox');
  });

  await check('S5 header nav moves week', async () => {
    const firstBefore = await page.locator('.g-day-head strong').first().innerText();
    await page.getByLabel('›').click();
    await page.waitForFunction(
      (prev) => document.querySelector('.g-day-head strong')?.textContent !== prev,
      firstBefore, { timeout: 8000 },
    );
    await page.getByLabel('‹').click();
    await page.waitForFunction(
      (prev) => document.querySelector('.g-day-head strong')?.textContent === prev,
      firstBefore, { timeout: 8000 },
    );
  });

  // ---------- GROUP G22-lib: S6 unified library, segments, routes, palette ----------
  await beginGroup('G22-lib', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store([], 'p1', {
        customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
        prompts: [{ id: 'p1', kind: 'llm', title: 'My save', templateId: 'sql', params: {}, created: 1 }],
      }),
    },
  }));

  await check('S6 slash focuses search', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').waitFor();
    await page.keyboard.press('/');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('data-testid') === 'prompt-search', null, { timeout: 8000 });
  });

  await check('S6 segments filter', async () => {
    await page.getByTestId('prompt-library').getByRole('button', { name: 'Изображение' }).click();
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[data-testid="prompt-item"]')].map((r) => r.textContent || '');
      return rows.length > 0 && rows.every((t) => !t.includes('Code review') && !t.includes('SQL explain'));
    }, null, { timeout: 8000 });
    await page.getByTestId('prompt-library').getByRole('button', { name: 'Все' }).click();
  });

  await check('S6 row opens workbench route', async () => {
    await page.locator('[data-testid="prompt-item"]', { hasText: 'SQL explain' }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/sql'), null, { timeout: 8000 });
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('SQL explain'), 'wrong workbench');
  });

  await check('S6 palette enter opens library item', async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('ENT plan');
    await page.locator('[data-testid^="palette-item-"]', { hasText: 'ENT plan' }).first().waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ent'), null, { timeout: 8000 });
  });

  await check('S6 badges read type origin', async () => {
    await page.getByTestId('nav-prompt').click();
    const t = await page.getByTestId('prompt-library').innerText();
    assert(t.includes('Картинка') && t.includes('Встроенный'), 'no type/origin badges: ' + t.slice(0, 160));
    assert(t.includes('Мой') && t.includes('Сохранённый'), 'no mine/saved badges: ' + t.slice(0, 160));
  });

  // ---------- GROUP G23-wb: S7 text-template workbench + result panel ----------
  await beginGroup('G23-wb', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('n1', 'Note-A', { updated: 2000 }),
          seedNote('n2', 'Note-B', { updated: 1000 }),
        ],
        'n1',
        {
          customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
          prompts: [],
        },
      ),
    },
  }));
  const openWorkbench = async (name) => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: name }).click();
    await page.getByTestId('prompt-workbench').waitFor();
  };

  await check('S7 form vertical required', async () => {
    await openWorkbench('Code review');
    const ys = [];
    for (const name of ['язык', 'уровень', 'код']) {
      const box = await page.getByLabel(name).boundingBox();
      assert(!!box, 'no field ' + name);
      ys.push(box.y);
    }
    assert(ys[0] < ys[1] && ys[1] < ys[2], 'form not vertical');
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('*'), 'required not marked');
  });

  await check('S7 autofocus enter nav', async () => {
    await openWorkbench('Code review');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'код', null, { timeout: 8000 });
    await page.getByLabel('язык').click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'уровень', null, { timeout: 8000 });
    await page.getByLabel('код').fill('SELECT 1');
    await page.keyboard.press('Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S7 ctrl enter copies', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('stars');
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S7 preview live click field', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('stars');
    await page.waitForFunction(() => (document.querySelector('[data-testid="prompt-result"]') || {}).innerText?.includes('stars'), null, { timeout: 8000 });
    await openWorkbench('Code review');
    await page.getByTestId('prompt-result').getByText('{{код}}').click();
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'код', null, { timeout: 8000 });
  });

  await check('S7 validation only after attempt', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('');
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Не заполнено') === false, 'error before attempt');
    await page.getByTestId('copy-prompt').click();
    await page.getByTestId('prompt-workbench', { hasText: 'Не заполнено' }).waitFor();
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'what', null, { timeout: 8000 });
  });

  await check('S7 save names dated renames in row', async () => {
    await page.getByLabel('what').fill('moons');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const todayDot = await page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    });
    const row = page.locator('[data-testid="prompt-item"]', { hasText: `My SQL · ${todayDot}` });
    await row.waitFor();
    await row.getByTestId('prompt-rename').click();
    await page.locator('[data-testid="prompt-item"] input').fill('Moons v2');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Moons v2' }).waitFor();
  });

  await check('S7 note chip binds unbinds with undo', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('comets');
    await page.getByRole('button', { name: /В заметку/ }).click();
    await page.locator('[data-testid^="w-note-pick-"]', { hasText: 'Note-A' }).click();
    await page.locator('.g-toasts', { hasText: 'Вставлено в заметку' }).waitFor();
    const chip = page.locator('.w-notechip', { hasText: 'Note-A' });
    await chip.waitFor();
    await chip.getByRole('button', { name: 'Отвязать' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('.w-notechip').count()) === 0, 'chip not cleared');
    await page.locator('.g-toast-undo').click();
    await page.locator('.w-notechip', { hasText: 'Note-A' }).waitFor();
  });

  await check('S7 more duplicates deletes with undo', async () => {
    const exactTitle = (t) => page.locator('.pl-title', { hasText: new RegExp(`^${t}$`) });
    await openWorkbench('My SQL');
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Дублировать' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pl-title')].filter((el) => el.textContent === 'My SQL').length === 2, null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My SQL' }).first().click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await exactTitle('My SQL').count()) === 1, 'not deleted');
    await page.locator('.g-toast-undo').click();
    assert((await exactTitle('My SQL').count()) === 2, 'undo did not restore');
  });

  // ---------- GROUP G24-img: S8 image-prompt tag constructor ----------
  await beginGroup('G24-img', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], 'p1') },
  }));
  const openImageWb = async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
  };

  await check('S8 tag input completes', async () => {
    await openImageWb();
    await page.getByTestId('tag-input').fill('blue');
    await page.locator('[data-testid^="tag-suggest-item-"]', { hasText: 'blue hair' }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).waitFor();
  });

  await check('S8 reorder alt arrows', async () => {
    await page.getByTestId('tag-input').fill('sunset');
    await page.keyboard.press('Enter');
    const order = () => page.locator('[data-testid="tag-chip"]').allInnerTexts();
    assert((await order()).join('|').includes('blue hair'), 'first chip lost');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).click();
    await page.keyboard.press('Alt+ArrowRight');
    assert((await order())[0].includes('sunset'), 'chips not swapped: ' + (await order()).join('|'));
  });

  await check('S8 model switch changes result', async () => {
    const before = await page.getByTestId('prompt-result').innerText();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Flux', exact: true }).click();
    await page.waitForFunction(
      (prev) => document.querySelector('[data-testid="prompt-result"]')?.textContent !== prev,
      before, { timeout: 8000 },
    );
  });

  await check('S8 copy copies', async () => {
    await page.getByTestId('copy-prompt').click();
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S8 recent tags', async () => {
    const t = await page.getByTestId('tag-recent').innerText();
    assert(t.includes('blue hair') && t.includes('sunset'), 'recent missing: ' + t.slice(0, 120));
  });

  await check('S8 save as template', async () => {
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'blue hair' }).first().waitFor();
  });

  // ---------- GROUP G25-builder: S9 template constructor ----------
  await beginGroup('G25-builder', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], 'p1') },
  }));
  const openBuilder = async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').getByRole('button', { name: '+ Новый шаблон' }).click();
    await page.getByTestId('prompt-builder').waitFor();
  };

  await check('S9 insert field selects name', async () => {
    await openBuilder();
    await page.getByTestId('builder-body').fill('Hello ');
    await page.getByTestId('builder-insert').click();
    assert((await page.getByTestId('builder-body').inputValue()).includes('{{поле_1}}'), 'not inserted');
    assert((await page.evaluate(() => (window.getSelection() || '').toString())) === 'поле_1', 'name not selected');
  });

  await check('S9 fields table live', async () => {
    await page.getByTestId('builder-body').fill('Hi {{city}}');
    await page.getByTestId('builder-field-city').waitFor();
  });

  await check('S9 syntax errors inline', async () => {
    await page.getByTestId('builder-body').fill('ok\nbroken {{oops');
    await page.getByTestId('builder-errors').waitFor();
    assert((await page.getByTestId('builder-errors').innerText()).includes('2'), 'no line number');
    await page.getByTestId('builder-body').fill('{{a}} {{b}}\nagain {{a}}');
    assert((await page.getByTestId('builder-errors').innerText()).includes('a'), 'no duplicate name');
  });

  await check('S9 ctrl shift f inserts', async () => {
    await page.getByTestId('builder-body').fill('X ');
    await page.keyboard.press('Control+Shift+F');
    await page.waitForFunction(() => (document.querySelector('[data-testid="builder-body"]') || {}).value?.includes('{{поле_1}}'), null, { timeout: 8000 });
  });

  await check('S9 save creates opens', async () => {
    await page.getByTestId('builder-name').fill('My Tpl');
    await page.getByTestId('builder-body').fill('Hi {{who}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ct'), null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My Tpl' }).waitFor();
  });

  await check('S9 type switch image', async () => {
    await openBuilder();
    await page.getByTestId('builder-name').fill('Img T');
    await page.getByTestId('builder-body').fill('a, b');
    await page.getByRole('button', { name: 'Картинка', exact: true }).click();
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    const row = page.locator('[data-testid="prompt-item"]', { hasText: 'Img T' });
    await row.waitFor();
    assert((await row.innerText()).includes('Картинка'), 'no image badge');
  });

  // ---------- GROUP G26-map: S10 canvas search, link drag, members, delete, orphans ----------
  await beginGroup('G26-map', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { updated: 3 }),
          seedNote('b1', 'Beta', { updated: 2 }),
          seedNote('c1', 'Gamma', { linkedIds: ['a1'], updated: 1 }),
        ],
        'a1',
        { graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }] },
      ),
    },
  }));
  const mapTransform = () => page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'));

  await check('S10 node search centers', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    await page.keyboard.press('/');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('data-testid') === 'map-search', null, { timeout: 8000 });
    const before = await mapTransform();
    await page.getByTestId('map-search').fill('Alpha');
    await page.keyboard.press('Enter');
    await page.getByTestId('map-peek').waitFor();
    assert((await page.getByTestId('map-peek').innerText()).includes('Alpha'), 'wrong peek');
    assert((await mapTransform()) !== before, 'canvas did not move');
  });

  await check('S10 drag links with undo', async () => {
    const edges = () => page.locator('line.g-vedge').count();
    assert((await edges()) === 1, 'seed edge missing');
    await page.getByTestId('map-link').click();
    const pa = await page.locator('circle.g-vnode[data-id="a1"]').boundingBox();
    const pb = await page.locator('circle.g-vnode[data-id="b1"]').boundingBox();
    assert(!!pa && !!pb, 'no node geometry');
    await page.mouse.move(pa.x + pa.width / 2, pa.y + pa.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('line.g-vedge').length === 2, null, { timeout: 8000 });
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    await page.waitForFunction(() => document.querySelectorAll('line.g-vedge').length === 1, null, { timeout: 8000 });
  });

  await check('S10 members compose', async () => {
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: /Team/ }).click();
    assert((await page.locator('circle.g-vnode').count()) === 1, 'scope not applied');
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Состав' }).click();
    await page.getByTestId('map-members').waitFor();
    await page.locator('.g-memberrow', { hasText: 'Beta' }).locator('input').check();
    await page.waitForFunction(() => document.querySelectorAll('circle.g-vnode').length === 2, null, { timeout: 8000 });
    await page.locator('.g-memberrow', { hasText: 'Beta' }).locator('input').uncheck();
    await page.waitForFunction(() => document.querySelectorAll('circle.g-vnode').length === 1, null, { timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  await check('S10 delete graph undo', async () => {
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    await page.getByTestId('map-graphs').click();
    assert((await page.getByTestId('map-graphs-pop').innerText()).includes('Team') === false, 'graph not deleted');
    await page.keyboard.press('Escape');
    await page.locator('.g-toast-undo').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).waitFor();
    await page.keyboard.press('Escape');
  });

  await check('S10 orphans chip highlights', async () => {
    const chip = page.getByTestId('map-orphans');
    await chip.waitFor();
    assert((await chip.innerText()).includes('(1)'), 'wrong orphan count');
    await chip.click();
    assert(((await page.locator('circle.g-vnode[data-id="b1"]').getAttribute('class')) || '').includes('hl'), 'orphan not highlighted');
  });

  // ---------- GROUP G27-mob: S11 mobile pass on two viewports ----------
  // Coarse-pointer CSS only applies in mobile emulation: both contexts use
  // isMobile + touch, like a real phone (plain small viewports would not).
  await beginGroup('G27-mob', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha note with a fairly long title', { text: 'alpha body', updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
        },
      ),
    },
  }));
  const mobCtx = (w, h) => browser.newContext({
    viewport: { width: w, height: h }, isMobile: true, hasTouch: true,
    storageState: storageStateFor(seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: {
        p1: v5store(
          [
            seedNote('a1', 'Alpha note with a fairly long title', { text: 'alpha body', updated: 2 }),
            seedNote('b1', 'Beta', { updated: 1 }),
          ],
          'a1',
          {
            tasks: [{ id: 't1', text: 'Today run task', done: false }],
            graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          },
        ),
      },
    })),
  });
  const noOverflow = async (pg, where, w) => {
    const bad = await pg.evaluate((want) => {
      const de = document.documentElement;
      if (window.innerWidth > want + 1) return `viewport expanded: ${window.innerWidth}>${want}`;
      return de.scrollWidth <= window.innerWidth + 1 ? null : `${de.scrollWidth}>${window.innerWidth}`;
    }, w);
    assert(bad === null, `horizontal overflow at ${where}: ${bad}`);
  };

  await check('S11 no horizontal overflow', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await noOverflow(m, 'notes', 390);
      await m.getByTestId('tab-plan').click();
      await noOverflow(m, 'plan-list', 390);
      await m.getByTestId('plan-view-week').click();
      await noOverflow(m, 'plan-week', 390);
      await m.getByTestId('tab-map').click();
      await noOverflow(m, 'map', 390);
      await m.getByTestId('tab-prompts').click();
      await noOverflow(m, 'prompts', 390);
      await m.evaluate(() => { window.location.hash = '#/settings/profiles'; });
      await m.getByTestId('settings-page').waitFor();
      await noOverflow(m, 'settings', 390);
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 notes drilldown', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      assert((await m.getByTestId('note-list').count()) === 0 || !(await m.getByTestId('note-list').isVisible()), 'list not hidden');
      await m.getByTestId('notes-back').click();
      await m.getByTestId('note-list').waitFor();
      assert(await m.getByTestId('note-list').isVisible(), 'list not back');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 plan add above tabbar', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-plan').click();
      await m.getByTestId('task-composer').click();
      await m.getByTestId('task-composer-title').fill('Mobile task');
      await m.getByTestId('task-add').click();
      await m.locator('[data-testid="task-row"]', { hasText: 'Mobile task' }).waitFor();
      assert(await m.getByTestId('tabbar').isVisible(), 'tabbar gone');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 palette quickadd mobile', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-add').click();
      await m.getByTestId('palette').waitFor();
      const w = await m.getByTestId('palette').evaluate((el) => el.getBoundingClientRect().width);
      assert(w >= 300, `palette narrow: ${w}`);
      await m.keyboard.press('Escape');
      assert((await m.getByTestId('palette').count()) === 0, 'palette stuck');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 targets coarse', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      const sizes = await m.evaluate(() => {
        const out = {};
        for (const [name, sel] of [['title', '.g-title-in'], ['back', '[data-testid="notes-back"]'], ['search', '[data-testid="task-search"]']]) {
          const el = document.querySelector(sel);
          out[name] = el ? Math.round(el.getBoundingClientRect().height) : -1;
        }
        return out;
      });
      // task-search lives on the plan section: measure it there.
      await m.getByTestId('tab-plan').click();
      const searchH = await m.evaluate(() => {
        const el = document.querySelector('[data-testid="task-search"]');
        return el ? Math.round(el.getBoundingClientRect().height) : -1;
      });
      assert(sizes.title >= 44, `title short: ${sizes.title}`);
      assert(sizes.back >= 44, `back short: ${sizes.back}`);
      assert(searchH >= 44, `search short: ${searchH}`);
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 narrow overflow drilldown', async () => {
    const ctx = await mobCtx(360, 740);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await noOverflow(m, 'notes-360');
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      await noOverflow(m, 'editor-360', 360);
      assert((await m.getByTestId('note-list').count()) === 0 || !(await m.getByTestId('note-list').isVisible()), 'list not hidden 360');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  // ---------- GROUP G28-keys: S12 shortcuts registry matrix ----------
  // Every SHORTCUTS entry in src/shortcuts.ts is exercised here.
  await beginGroup('G28-keys', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { text: 'alpha body', updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
        },
      ),
    },
  }));
  const activeTestid = () => page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'));

  await check('S12 keys page lists the 15 registry rows', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 15, 'keys rows != registry');
  });

  await check('S12 Ctrl+K opens palette, Esc closes', async () => {
    await page.getByTestId('nav-notes').click();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="palette"]'), null, { timeout: 8000 });
  });

  await check('S12 Alt+0 resets panels', async () => {
    await page.getByTestId('nav-notes').click();
    await page.getByLabel('Правая панель').click();
    await page.locator('.g-rail-r').waitFor();
    await page.locator('.s-rail').getByLabel('Меню').click();
    await page.keyboard.press('Alt+0');
    assert((await page.locator('.s-rail.collapsed').count()) === 0, 'sidebar not reset');
    assert((await page.locator('.g-right').count()) === 1, 'right not open');
  });

  await check('S12 Ctrl+Alt+N creates a note', async () => {
    await page.getByTestId('nav-notes').click();
    const before = await page.getByTestId('note-item').count();
    await page.keyboard.press('Control+Alt+n');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="note-item"]').length === n + 1, before, { timeout: 8000 });
  });

  await check('S12 slash focuses notes search', async () => {
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('notes-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'notes-search', 'notes search not focused');
  });

  await check('S12 N creates a note in notes', async () => {
    await page.getByTestId('nav-notes').click();
    const before = await page.getByTestId('note-item').count();
    await page.keyboard.press('n');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="note-item"]').length === n + 1, before, { timeout: 8000 });
  });

  await check('S12 plan slash and N', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'task-search', 'plan search not focused');
    await page.getByTestId('nav-plan').click();
    await page.keyboard.press('n');
    assert((await activeTestid()) === 'task-composer-title', 'composer not focused');
  });

  await check('S12 Enter opens task panel, button closes', async () => {
    await page.getByTestId('nav-plan').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run task' }).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-close').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="task-panel"]'), null, { timeout: 8000 });
  });

  await check('S12 Delete removes task, Undo restores', async () => {
    await page.getByTestId('nav-plan').click();
    const row = page.locator('[data-testid="task-row"]', { hasText: 'Today run task' });
    await row.focus();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="task-row"]')].some((r) => (r.textContent || '').includes('Today run task')), null, { timeout: 8000 });
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run task' }).waitFor();
  });

  await check('S12 week arrows move, T returns', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const first = () => page.locator('[data-testid^="day-cell-"]').first().getAttribute('data-testid');
    const was = await first();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') !== w, was, { timeout: 8000 });
    await page.keyboard.press('t');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') === w, was, { timeout: 8000 });
  });

  await check('S12 slash focuses map search', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'map-search', 'map search not focused');
  });

  await check('S12 slash focuses library search', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'prompt-search', 'library search not focused');
  });

  await check('S12 Ctrl+Shift+F inserts a field', async () => {
    await page.evaluate(() => { window.location.hash = '#/prompts/new'; });
    await page.getByTestId('prompt-builder').waitFor();
    await page.getByTestId('builder-body').fill('X ');
    await page.keyboard.press('Control+Shift+f');
    await page.waitForFunction(() => (document.querySelector('[data-testid="builder-body"]') || {}).value?.includes('{{поле_1}}'), null, { timeout: 8000 });
  });

  await check('S12 Ctrl+Enter copies the result', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My SQL' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('what').fill('moons');
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S12 KZ keys layout has no overflow', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByRole('button', { name: 'KZ', exact: true }).click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 15, 'keys rows missing in KZ');
    const bad = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth <= window.innerWidth + 1 ? null : `${de.scrollWidth}>${window.innerWidth}`;
    });
    assert(bad === null, `horizontal overflow in KZ keys: ${bad}`);
  });

  // ---------- GROUP G29-kpi: S13 interaction budgets (minimal sequences) ----------
  await beginGroup('G29-kpi', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { text: 'alpha body one two', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha body one two' }] }] }, updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          customTpls: [{ id: 'ct2', name: 'Clip me', body: 'Run {{cmd}}', defaults: { cmd: 'ls' } }],
        },
      ),
    },
  }));

  await check('S13 new task: N, text, Enter', async () => {
    await page.getByTestId('nav-plan').click();
    await page.keyboard.press('n');
    await page.getByTestId('task-composer-title').fill('KPI task');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"]', { hasText: 'KPI task' }).waitFor();
    assert((await activeTestid()) === 'task-composer-title', 'focus left composer (no serial input)');
  });

  await check('S13 day task: cell click, text, Enter', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const cell = page.locator('[data-testid^="day-cell-"]').first();
    await cell.waitFor();
    await cell.click({ position: { x: 8, y: 8 } });
    await page.getByTestId('day-popup-title').fill('KPI day task');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"], [data-testid^="day-cell-"]', { hasText: 'KPI day task' }).first().waitFor();
    assert((await page.getByTestId('day-popup').count()) === 1, 'popup closed (no serial input)');
  });

  await check('S13 prompt copy mouse in 2 clicks', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Clip me' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('copy-prompt').click();
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S13 prompt copy keyboard: /, query, Enter, Ctrl+Enter', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('clip');
    await page.keyboard.press('Enter');
    await page.getByTestId('prompt-workbench', { hasText: 'Clip me' }).waitFor();
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S13 note switch in 1 click', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Alpha' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value === 'Beta', null, { timeout: 8000 });
  });

  await check('S13 link: [[, query, Enter', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Alpha' }).click();
    await page.locator('.tiptap').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[[Bet');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-right', { hasText: 'Beta' }).waitFor();
  });

  await check('S13 note delete+undo is 1+1', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).waitFor();
  });

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

