// E2E group G18-shell (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, v5store, seedNote, beginGroup, storageStateFor, check, assert, page, browser } = t;

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
};
