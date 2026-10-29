// E2E group G5-prompt (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { openContext, closeContext } = t;
  const { seedProfiles, v5store, beginGroup, check, assert, newViaPalette, pickViaPalette, page } = t;

  // ---------- GROUP G5-prompt: prompt page on an empty store ----------
  await beginGroup('G5-prompt', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], '') },
  }));

  await check('P13 template builder creates edits deletes', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').getByRole('button', { name: '+ Новый шаблон' }).click();
    await page.getByTestId('prompt-builder').waitFor();
    const templateName = 'Blue eyes template';
    await page.getByTestId('builder-name').fill(templateName);
    await page.getByTestId('builder-body').fill('blue eyes and {{style}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ct'), null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).waitFor();
    await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Изменить' }).click();
    await page.getByTestId('prompt-builder').waitFor();
    assert((await page.getByTestId('builder-name').inputValue()) === templateName, 'template is not editable');
    await page.getByTestId('builder-body').fill('blue hair and {{style}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="prompt-result"]') || {}).innerText?.includes('blue hair'), null, { timeout: 8000 });
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="prompt-item"]', { hasText: templateName }).count()) === 0, 'template not deleted');
  });
  await check('P13 llm template save', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').fill('sql');
    assert((await page.locator('[data-testid="prompt-item"]').count()) === 1, 'search must narrow rows');
    await page.getByTestId('prompt-search').fill('');
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('x');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).waitFor();
  });


  await check('P13b bind to note + open + unbind', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Prompthost');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).filter({ hasText: 'Встроенный' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('probe');
    await page.getByRole('button', { name: /В заметку/ }).click();
    await page.locator('[data-testid^="w-note-pick-"]', { hasText: 'Prompthost' }).click();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'Prompthost' }).first().locator('.g-noteopen').click();
    await openContext(page, 'prompts');
    const card = page.getByTestId('ctx-panel').getByRole('tabpanel');
    await card.waitFor();
    assert((await card.innerText()).includes('Code review'), 'not linked');
    await card.getByRole('button', { name: 'Открыть' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Code review'), 'linked save did not open');
    await pickViaPalette(page, 'Prompthost');
    await openContext(page, 'prompts');
    await page.getByTestId('ctx-panel').getByRole('tabpanel').getByRole('button', { name: 'Отвязать' }).click();
    assert((await page.getByTestId('ctx-panel').getByRole('tabpanel').innerText()).includes('Нет привязанных'), 'not unbound');
  });



  await check('P13d syntax per model + inline risk', async () => {
    await closeContext(page);
    const lastBody = () => page.evaluate(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls.slice(-1)[0] || {}).body || '');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByTestId('tag-input').fill('blue skin');
    const risk = await page.locator('[data-testid^="tag-suggest-item-"]', { hasText: 'blue skin' }).innerText();
    assert(risk.includes('%'), `risk rate missing: ${risk.slice(0, 80)}`);
    await page.getByTestId('tag-input').fill('blue');
    await page.locator('[data-testid^="tag-suggest-item-"]').first().waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue hair' }).waitFor();
    await page.getByRole('button', { name: 'SDXL', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'masterpiece, best quality (SDXL)' }).waitFor();
    await page.waitForFunction(() => ((JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => (t.body || '').includes('(blue'))), null, { timeout: 8000 });
    const sdxlBody = await lastBody();
    assert(sdxlBody.includes('(blue hair)') || sdxlBody.includes('(blue eyes)'), `bad SDXL body: ${sdxlBody.slice(0, 120)}`);
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByRole('button', { name: 'Flux', exact: true }).click();
    await page.getByTestId('tag-input').fill('blue');
    await page.locator('[data-testid^="tag-suggest-item-"]').first().waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="tag-chip"]', { hasText: 'blue eyes' }).waitFor();
    await page.getByRole('button', { name: 'Сохранить как шаблон' }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'masterpiece, best quality (Flux)' }).waitFor();
    await page.waitForFunction(() => ((JSON.parse(window.localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((t) => (t.body || '').includes('blue eyes') && !(t.body || '').includes('(blue'))), null, { timeout: 8000 });
    const fluxBody = await lastBody();
    assert(/blue (hair|eyes)/.test(fluxBody) && !fluxBody.includes('(blue'), `bad Flux body: ${fluxBody.slice(0, 120)}`);
  });

  await check('P14 no cloud sync wording', async () => {
    // The status honestly shows Сохраняется… while a save is armed: let the
    // debounce window settle so the wording assertions read a final state.
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="save-state"]')?.textContent?.includes('Сохраняется'),
      null,
      { timeout: 8000 },
    );
    const status = await page.getByTestId('save-state').innerText();
    assert(status.includes('Сохранено локально'), `save-state: ${status}`);
    assert(!status.includes('синхронизировано'), 'sync illusion in save-state');
    assert((await page.getByRole('button', { name: 'Синхронизировать' }).count()) === 0, 'sync button present');
    const main = await page.locator('.g-main').innerText();
    assert(!main.includes('синхронизировано') && !main.includes('Синхронизировать'), 'sync wording on page');
  });
};
