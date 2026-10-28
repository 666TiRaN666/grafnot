// E2E group G15-twotab (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, seedProfiles, v5store, seedNote, reseed, groupActive, openSecondTab, check, assert, page, ctx } = t;

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
};
