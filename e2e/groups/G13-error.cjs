// E2E group G13-error (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, v5store, seedNote, groupActive, storageStateFor, check, assert, browser } = t;

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
};
