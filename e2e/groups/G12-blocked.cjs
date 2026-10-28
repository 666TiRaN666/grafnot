// E2E group G12-blocked (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, GROUP_FILTER, setTailFailure, attachErrorGuards, seedProfiles, v5store, seedNote, reseed, groupActive, storageStateFor, check, assert, page, browser } = t;

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
    await check('read failure blocks editing and writes; retry restores original data', async () => {
      const raw = JSON.stringify(v5store([seedNote('read-note', 'Original read data')], 'read-note'));
      const readContext = await browser.newContext({ storageState: storageStateFor(blockedSeed(raw)) });
      try {
        await readContext.addInitScript(() => {
          const get = Storage.prototype.getItem;
          const set = Storage.prototype.setItem;
          window.readDenied = true;
          window.storeWrites = 0;
          Storage.prototype.getItem = function (key) {
            if (key === 'grafnot-store-b1' && window.readDenied) throw new DOMException('Read denied', 'SecurityError');
            return get.call(this, key);
          };
          Storage.prototype.setItem = function (key, value) {
            if (key.startsWith('grafnot-store-')) window.storeWrites += 1;
            return set.call(this, key, value);
          };
        });
        const readPage = await readContext.newPage();
        attachErrorGuards(readPage);
        await readPage.goto(URL, { waitUntil: 'networkidle' });
        await readPage.getByTestId('storage-retry').waitFor();
        assert(await readPage.getByTestId('quickadd').isDisabled(), 'creation enabled while storage is unreadable');
        assert(await readPage.getByTestId('editor').count() === 0, 'editor exposed while storage is unreadable');
        await readPage.keyboard.press('Control+Alt+n');
        await readPage.getByTestId('storage-retry').click();
        await readPage.getByTestId('storage-retry').waitFor();
        await readPage.waitForTimeout(650);
        assert(await readPage.evaluate(() => window.storeWrites) === 0, 'blocked profile wrote data');
        await readPage.evaluate(() => { window.readDenied = false; });
        assert(await readPage.evaluate(() => localStorage.getItem('grafnot-store-b1')) === raw, 'original raw changed');
        await readPage.getByTestId('storage-retry').click();
        await readPage.getByTestId('note-item').filter({ hasText: 'Original read data' }).waitFor();
        await readPage.getByTestId('note-item').filter({ hasText: 'Original read data' }).click();
        await readPage.getByTestId('title-in').waitFor();
        assert(await readPage.getByTestId('title-in').inputValue() === 'Original read data', 'retry lost original data');
        await readPage.getByTestId('title-in').fill('Recovered edit');
        await readPage.getByTestId('title-in').press('Enter');
        await readPage.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-b1')).notes[0].title === 'Recovered edit');
      } finally {
        await readContext.close();
      }
    });
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
      const raw = JSON.stringify({ schemaVersion: 7, notes: [], tasks: [], activeId: '' });
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
    if (orphans.length > 0) setTailFailure('orphan profile stores left: ' + orphans.join(','));
  }
};
