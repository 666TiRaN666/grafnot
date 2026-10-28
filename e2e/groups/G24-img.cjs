// E2E group G24-img (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, check, assert, page } = t;

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
    // Built-in art opens with its default tags (UX-03): reorder the two added last.
    await page.getByTestId('tag-input').fill('night');
    await page.keyboard.press('Enter');
    const order = () => page.locator('[data-testid="tag-chip"]').allInnerTexts();
    assert((await order()).join('|').includes('blue hair'), 'added chip lost');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).click();
    await page.keyboard.press('Alt+ArrowRight');
    const o = await order();
    assert(o[o.length - 2].includes('night') && o[o.length - 1].includes('blue hair'), 'chips not swapped: ' + o.join('|'));
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
    assert(t.includes('blue hair') && t.includes('night'), 'recent missing: ' + t.slice(0, 120));
  });

  await check('S8 save as template', async () => {
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    // Name = first two tags: the art defaults come first now (UX-03).
    await page.locator('[data-testid="prompt-item"]', { hasText: 'masterpiece, best quality (Flux)' }).first().waitFor();
  });

  await check('S8 Flux hides weight controls, result clean', async () => {
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Pony', exact: true }).click();
    // Save-as-template above navigated to the new template (its tokens restored; re-add is a no-op).
    await page.getByTestId('tag-input').fill('blue hair');
    await page.keyboard.press('Enter');
    const chip = page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' });
    await chip.waitFor();
    await chip.getByLabel('Меню').click();
    assert((await page.getByRole('menuitemradio').count()) === 3, 'no weight items under Pony');
    await page.getByRole('menuitemradio', { name: 'Сильнее' }).click();
    await page.locator('[data-testid="tag-chip"]', { hasText: '((blue hair))' }).waitFor();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Flux', exact: true }).click();
    await page.waitForFunction(
      () => !(document.querySelector('[data-testid="prompt-result"]')?.textContent || '').includes('(('),
      null, { timeout: 8000 },
    );
    await chip.getByLabel('Меню').click();
    assert((await page.getByRole('menuitemradio').count()) === 0, 'weight items visible under Flux');
  });

  await check('S8 Pony restores kept weights', async () => {
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Pony', exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="prompt-result"]')?.textContent || '').includes('((blue hair))'),
      null, { timeout: 8000 },
    );
  });

  // UX-03: an image template comes back with its model, tags and weights.
  const chips = () => page.locator('[data-testid="tag-chip"]');
  const pressed = (m) => page.getByTestId('prompt-workbench').getByRole('button', { name: m, exact: true }).getAttribute('aria-pressed');

  await check('F3 built-in art opens with its tags', async () => {
    await openImageWb();
    await chips().first().waitFor();
    const all = (await chips().allInnerTexts()).join('|');
    assert((await chips().count()) === 8 && all.includes('masterpiece') && all.includes('long black hair'), 'art tags: ' + all);
    assert((await page.getByTestId('prompt-result').innerText()).trim() !== '—', 'empty result');
  });

  await check('F3 saved Flux template restores model, tags, weight after reload', async () => {
    await openImageWb();
    await chips().first().waitFor();
    await page.getByTestId('tag-input').focus();
    for (let i = (await chips().count()); i > 0; i--) await page.keyboard.press('Backspace');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="tag-chip"]').length === 0, null, { timeout: 8000 });
    await page.getByTestId('tag-input').fill('blue eyes');
    await page.locator('[data-testid^="tag-suggest-item-"]', { hasText: 'blue eyes' }).first().waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('tag-input').fill('watercolor');
    await page.keyboard.press('Enter');
    await chips().nth(1).waitFor();
    await chips().first().getByLabel('Меню').click();
    await page.getByRole('menuitemradio', { name: 'Сильнее' }).click();
    await page.locator('[data-testid="tag-chip"]', { hasText: '((blue eyes))' }).waitFor();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Flux', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    const row = page.locator('[data-testid="prompt-item"]', { hasText: 'watercolor (Flux)' }).first();
    await row.waitFor();
    await page.getByTestId('nav-notes').click();
    await page.waitForFunction(() => ((JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => (t.body || '').includes('watercolor'))), null, { timeout: 8000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'watercolor (Flux)' }).first().click();
    await page.getByTestId('tag-input').waitFor();
    assert((await pressed('Flux')) === 'true', 'model not restored');
    const got = await chips().allInnerTexts();
    assert(got.length === 2 && got[0].includes('((blue eyes))') && got[1].includes('watercolor'), 'tags not restored: ' + got.join('|'));
    const res = (await page.getByTestId('prompt-result').innerText()).trim();
    assert(res === 'blue eyes and watercolor', 'result (and counter) wrong: ' + res);
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Pony', exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="prompt-result"]')?.textContent || '') === '((blue eyes)), watercolor',
      null, { timeout: 8000 },
    );
  });
};
