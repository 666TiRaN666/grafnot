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

  await check('S8 tags sort into lanes; Alt+arrows reorder inside a lane', async () => {
    // Built-in art opens with its default tags (UX-03); a new tag lands in its lane.
    await page.getByTestId('tag-input').fill('night');
    await page.keyboard.press('Enter');
    await page.getByTestId('lane-scene').locator('[data-testid="tag-chip"]', { hasText: 'night' }).waitFor();
    const look = () => page.getByTestId('lane-look').locator('[data-testid="tag-chip"]').allInnerTexts();
    const before = await look();
    assert(before.length >= 2 && before[before.length - 1].includes('blue hair'), 'look lane: ' + before.join('|'));
    await page.getByTestId('lane-look').locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).click();
    await page.keyboard.press('Alt+ArrowLeft');
    const after = await look();
    assert(after[after.length - 2].includes('blue hair') && after[after.length - 1] === before[before.length - 2], 'chips not swapped: ' + after.join('|'));
    // The prompt follows lane order: quality first, the place after the look.
    const res = await page.getByTestId('prompt-result').innerText();
    assert(res.indexOf('masterpiece') < res.indexOf('blue hair') && res.indexOf('blue hair') < res.indexOf('night'), 'prompt not in lane order: ' + res);
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
    await page.getByTestId('img-save-tpl').click();
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
    await page.locator('[data-testid="tag-chip"]', { hasText: '(blue hair:1.2)' }).waitFor();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Flux', exact: true }).click();
    await page.waitForFunction(
      () => !(document.querySelector('[data-testid="prompt-result"]')?.textContent || '').includes(':1.2'),
      null, { timeout: 8000 },
    );
    await chip.getByLabel('Меню').click();
    assert((await page.getByRole('menuitemradio').count()) === 0, 'weight items visible under Flux');
  });

  await check('S8 Pony restores kept weights', async () => {
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Pony', exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="prompt-result"]')?.textContent || '').includes('(blue hair:1.2)'),
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
    await page.locator('[data-testid="tag-chip"]', { hasText: '(blue eyes:1.2)' }).waitFor();
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Flux', exact: true }).click();
    await page.getByTestId('img-save-tpl').click();
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
    assert(got.length === 2 && got[0].includes('(blue eyes:1.2)') && got[1].includes('watercolor'), 'tags not restored: ' + got.join('|'));
    const res = (await page.getByTestId('prompt-result').innerText()).trim();
    // Flux reads a sentence (focus group); the weight never reaches its text.
    assert(res === 'Blue eyes. Details: watercolor.', 'result (and counter) wrong: ' + res);
    await page.getByTestId('prompt-workbench').getByRole('button', { name: 'Pony', exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="prompt-result"]')?.textContent || '') === '(blue eyes:1.2), watercolor',
      null, { timeout: 8000 },
    );
  });

  const model = (m) => page.getByTestId('prompt-workbench').getByRole('button', { name: m, exact: true }).click();
  const result = () => page.getByTestId('prompt-result').innerText();

  await check('Image: negative prompt, frame and syntax differ per model and survive a save', async () => {
    await openImageWb();
    await chips().first().waitFor();
    await model('Pony');
    await page.getByTestId('neg-preset').click();
    assert(await page.getByTestId('neg-chip').count() === 9, 'negative preset not added');
    assert((await page.getByTestId('prompt-negative').innerText()).includes('bad hands'), 'negative prompt missing');
    await page.getByTestId('aspect-2:3').click();
    assert((await page.getByTestId('prompt-params').innerText()).includes('832 × 1216'), 'frame size missing');
    await page.getByTestId('pony-score').check();
    assert((await result()).startsWith('score_9, score_8_up, score_7_up, masterpiece'), 'Pony quality prefix missing');
    await model('Midjourney');
    const mj = await result();
    assert(mj.includes('--ar 2:3') && mj.includes('--no lowres') && !mj.includes('score_9'), 'Midjourney parameters wrong: ' + mj);
    assert(await page.getByTestId('prompt-negative').count() === 0, 'Midjourney shows a separate negative prompt');
    await model('Flux');
    assert(await page.getByTestId('neg-input').isDisabled(), 'Flux accepts a negative prompt');
    const flux = await result();
    assert(!flux.includes('--ar') && !flux.includes('score_9'), 'Flux carries foreign syntax: ' + flux);
    await model('Midjourney');
    await page.getByTestId('img-save-tpl').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: '(Midjourney)' }).first().waitFor();
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => t.model === 'Midjourney' && t.aspect === '2:3' && (t.negative || []).length === 9), null, { timeout: 8000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: '(Midjourney)' }).first().click();
    await page.getByTestId('tag-input').waitFor();
    assert(await page.getByTestId('aspect-2:3').getAttribute('aria-pressed') === 'true', 'frame not restored');
    assert(await page.getByTestId('neg-chip').count() === 9, 'negative not restored');
  });

  await check('Image: the chip menu reorders tags without a keyboard', async () => {
    await openImageWb();
    await page.getByTestId('tag-input').fill('blue eyes');
    await page.keyboard.press('Enter');
    const look = () => page.getByTestId('lane-look').locator('[data-testid="tag-chip"]').allInnerTexts();
    const before = await look();
    const last = page.getByTestId('lane-look').locator('[data-testid="tag-chip"]').last();
    await last.getByLabel('Меню').click();
    await page.getByRole('menuitem', { name: /Раньше/ }).click();
    const after = await look();
    assert(after[after.length - 2] === before[before.length - 1] && after[after.length - 1] === before[before.length - 2], 'menu did not move the tag: ' + after.join('|'));
  });

  await check('Image: weight steps by 0.1 in the chip menu; Flux reads a sentence', async () => {
    await openImageWb();
    await page.getByTestId('tag-input').fill('green eyes');
    await page.keyboard.press('Enter');
    const chip = page.getByTestId('lane-look').locator('[data-testid="tag-chip"]', { hasText: 'green eyes' });
    await chip.getByLabel('Меню').click();
    assert(await page.getByTestId('tag-w-value').innerText() === '1.0', 'weight value missing');
    await page.getByTestId('tag-w-up').click();
    await page.getByTestId('tag-w-up').click();
    await page.getByTestId('tag-w-up').click();
    await page.getByTestId('lane-look').locator('[data-testid="tag-chip"]', { hasText: '(green eyes:1.3)' }).waitFor({ timeout: 5000 })
      .catch(() => { throw new Error('three steps did not give 1.3'); });
    assert(await page.getByTestId('tag-w-value').innerText() === '1.3', 'value not shown after steps');
    assert((await result()).includes('(green eyes:1.3)'), 'weight missing from the prompt: ' + await result());
    await page.keyboard.press('Escape');
    await model('Flux');
    const flux = await result();
    assert(/^A girl\b/.test(flux) && flux.includes('green eyes') && !flux.includes('(green eyes') && !flux.includes('masterpiece') && /\.$/.test(flux), 'Flux is not a sentence: ' + flux);
  });

  await check('Image: a tag moved to another lane takes the prompt order with it', async () => {
    await openImageWb();
    const chip = page.getByTestId('lane-scene').locator('[data-testid="tag-chip"]', { hasText: 'sunset' });
    await chip.waitFor();
    await chip.getByLabel('Меню').click();
    await page.getByTestId('tag-cat').selectOption('light');
    await page.getByTestId('lane-light').locator('[data-testid="tag-chip"]', { hasText: 'sunset' }).waitFor();
    assert(await page.getByTestId('lane-scene').count() === 0, 'empty lane still shown');
  });
};
