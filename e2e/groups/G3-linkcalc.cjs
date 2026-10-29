// E2E group G3-linkcalc (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { openContext, insertCalculation } = t;
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, newViaPalette, page } = t;

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
    await openContext(page);
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.getByTestId('ctx-panel').getByRole('tabpanel').locator('li', { hasText: 'Alpha' }).waitFor();
  });
  await check('P3 unlink offers undo', async () => {
    await page.getByTestId('ctx-panel').getByRole('tabpanel').locator('li', { hasText: 'Alpha' }).locator('.g-unlink').click();
    assert((await page.locator('.g-unlink').count()) === 0, 'link not removed');
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    await page.getByTestId('ctx-panel').getByRole('tabpanel').locator('li', { hasText: 'Alpha' }).waitFor();
  });

  // ---------- P4: calculations list ----------
  await check('P4 add calc 2+3*4=14', async () => {
    await insertCalculation(page);
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
    await insertCalculation(page);
    await page.locator('.g-calc-name').last().fill('a');
    await page.locator('.g-calc-expr').last().fill('2+3');
    assert((await page.locator('.g-calc-res').last().innerText()).includes('5'), 'a!=5');
    await insertCalculation(page);
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
};
