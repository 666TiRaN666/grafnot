// E2E group G10-p27 (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, seedLegacy, v5store, seedNote, reseed, groupActive, storageStateFor, check, assert, page, browser } = t;

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
};
