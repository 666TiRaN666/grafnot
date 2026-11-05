// D10 stress diagnostic: two writers on one profile store, unload right
// after typing, profile deletion while dirty, quota exhaustion.
// Invariant: an edit is either in storage or loudly reported (conflict /
// not saved) in the tab that made it. A missing edit with a "saved" status
// is a silent loss.
// Usage: build, serve dist (vite preview --port 5310 --host 127.0.0.1), then
//   node scripts/d10-stress.cjs            (N=40 interleavings by default)
//   QUOTA_ONLY=1 node scripts/d10-stress.cjs
// Prints JSON. Diagnostic only: not part of gates (timing-based, ~6 min).
const ROOT = require('path').resolve(__dirname, '..');
const { chromium } = require(ROOT + '/node_modules/playwright-core');
const EXE = require(ROOT + '/scripts/chrome-exe.cjs');
const URL = process.env.URL || 'http://127.0.0.1:5310/';
const N = Number(process.env.N || 40);

const seedState = () => {
  const store = {
    schemaVersion: 7, notes: [{ id: 'a', title: 'Alpha', content: '<p>start</p>', text: 'start', linkedIds: [], calcs: [], updated: 1 }],
    tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'a', trashMeta: {},
  };
  return {
    cookies: [],
    origins: [{ origin: URL.replace(/\/$/, ''), localStorage: [
      { name: 'grafnot-profiles-v1', value: JSON.stringify({ profiles: [{ id: 'p1', name: 'Main', created: 1 }, { id: 'p2', name: 'Spare', created: 2 }], activeId: 'p1' }) },
      { name: 'grafnot-store-p1', value: JSON.stringify(store) },
      { name: 'grafnot-store-p2', value: JSON.stringify({ ...store, notes: [] , activeId: null }) },
    ] }],
  };
};

const status = (pg) => pg.getByTestId('save-state').innerText().catch(() => '?');
const loud = (s) => /Конфликт|НЕ сохранено|conflict|NOT saved/i.test(s);
const stored = (pg) => pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a')?.text ?? ''; } catch { return null; } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function openTab(ctx) {
  const pg = await ctx.newPage();
  await pg.goto(URL + '#/notes/a', { waitUntil: 'networkidle' });
  await pg.getByTestId('editor').getByRole('textbox').waitFor();
  return pg;
}
async function typeEnd(pg, s) {
  await pg.getByTestId('editor').getByRole('textbox').click();
  await pg.keyboard.press('Control+End');
  await pg.keyboard.type(s);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const out = { interleave: { runs: 0, silentLoss: 0, conflictsShown: 0, bothSaved: 0, details: [] }, unload: { runs: 0, lost: 0, details: [] }, deleteDirty: { runs: 0, resurrected: 0, silent: 0 }, quota: {} };
  try {
    // 1. Two tabs, random interleaving of typing and debounce windows.
    for (let i = 0; i < (process.env.QUOTA_ONLY ? 0 : N); i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: seedState() });
      const A = await openTab(ctx), B = await openTab(ctx);
      const ta = `A${i}x`, tb = `B${i}y`;
      const da = rnd(0, 700), db = rnd(0, 700);
      await Promise.all([(async () => { await sleep(da); await typeEnd(A, ' ' + ta); })(), (async () => { await sleep(db); await typeEnd(B, ' ' + tb); })()]);
      await sleep(1500);
      const sa = await status(A), sb = await status(B), text = await stored(A);
      const lostA = !text.includes(ta) && !loud(sa), lostB = !text.includes(tb) && !loud(sb);
      out.interleave.runs++;
      if (lostA || lostB) { out.interleave.silentLoss++; out.interleave.details.push({ i, da, db, sa, sb, text }); }
      if (loud(sa) || loud(sb)) out.interleave.conflictsShown++;
      if (text.includes(ta) && text.includes(tb)) out.interleave.bothSaved++;
      await ctx.close();
    }
    // 2. Close the tab right after the last keystroke (debounce not elapsed).
    for (let i = 0; i < (process.env.QUOTA_ONLY ? 0 : Math.ceil(N / 2)); i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: seedState() });
      const A = await openTab(ctx);
      const tok = `U${i}z`, wait = rnd(0, 380);
      await typeEnd(A, ' ' + tok);
      await sleep(wait);
      await A.close({ runBeforeUnload: true });
      const probe = await ctx.newPage();
      await probe.goto(URL + '#/settings', { waitUntil: 'domcontentloaded' });
      const text = await stored(probe);
      out.unload.runs++;
      if (!text.includes(tok)) { out.unload.lost++; out.unload.details.push({ i, wait, text }); }
      await ctx.close();
    }
    // 3. Delete the profile in tab B while tab A holds an unsaved edit.
    for (let i = 0; i < (process.env.QUOTA_ONLY ? 0 : 10); i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: seedState() });
      const A = await openTab(ctx);
      const B = await ctx.newPage();
      await B.goto(URL + '#/settings/profiles', { waitUntil: 'networkidle' });
      await typeEnd(A, ' D' + i);
      await B.evaluate(() => {
        const r = JSON.parse(localStorage.getItem('grafnot-profiles-v1'));
        r.profiles = r.profiles.filter((p) => p.id !== 'p1'); r.activeId = 'p2';
        localStorage.setItem('grafnot-profiles-v1', JSON.stringify(r));
        localStorage.removeItem('grafnot-store-p1');
      });
      await sleep(1500);
      const sa = await status(A);
      const back = await A.evaluate(() => localStorage.getItem('grafnot-store-p1') !== null);
      out.deleteDirty.runs++;
      if (back) out.deleteDirty.resurrected++;
      if (!loud(sa) && !back) out.deleteDirty.silent++;
      await ctx.close();
    }
    // 4. Quota: fill storage, type, expect a loud failure and an intact old copy; free space, expect the retry to land.
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: seedState() });
      const A = await openTab(ctx);
      const before = await stored(A);
      const filled = await A.evaluate(() => {
        let n = 0; const chunk = 'x'.repeat(256 * 1024);
        try { for (;;) { localStorage.setItem('filler-' + n, chunk); n++; } } catch { /* full */ }
        let small = 0; try { for (;;) { localStorage.setItem('fill-s-' + small, 'x'.repeat(1024)); small++; } } catch { /* full */ }
        return { chunks: n, small };
      });
      const rawBefore = await A.evaluate(() => localStorage.getItem('grafnot-store-p1'));
      await A.getByTestId('editor').getByRole('textbox').click();
      await A.keyboard.press('Control+End');
      const t0 = Date.now();
      await A.keyboard.insertText(' ' + 'Q'.repeat(4000));
      let sa = '';
      for (let k = 0; k < 30; k++) { sa = await status(A); if (loud(sa)) break; await sleep(100); }
      const msToLoud = Date.now() - t0;
      const rawAfter = await A.evaluate(() => localStorage.getItem('grafnot-store-p1'));
      const intact = rawAfter === rawBefore && (await stored(A)) === before;
      await A.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('fill')) localStorage.removeItem(k); });
      await typeEnd(A, 'R');
      let after = '';
      for (let k = 0; k < 40; k++) { after = await stored(A); if (after.includes('QR')) break; await sleep(100); }
      out.quota = { filled, loudStatus: sa, msToLoud, oldCopyIntact: intact, retryLanded: after.includes('QR'), finalStatus: await status(A) };
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(out, null, 1));
})();
