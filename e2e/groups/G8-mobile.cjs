// E2E group G8-mobile (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, groupActive, storageStateFor, check, assert, browser } = t;

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
};
