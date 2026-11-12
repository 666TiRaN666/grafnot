// E2E group G22-lib (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, check, assert, page } = t;

  // ---------- GROUP G22-lib: S6 unified library, segments, routes, palette ----------
  await beginGroup('G22-lib', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store([], 'p1', {
        customTpls: [
          { id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} },
          { id: 'ct2', name: 'Long brief', body: 'Начало длинного шаблона, первые семьдесят символов без искомого слова, дальше: зебраслово {{тема}}', defaults: {} },
        ],
        prompts: [{ id: 'p1', kind: 'llm', title: 'My save', templateId: 'sql', params: {}, created: 1 }],
      }),
    },
  }));

  await check('S6 segments filter', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').waitFor();
    await page.getByTestId('prompt-library').getByRole('button', { name: 'Изображение' }).click();
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[data-testid="prompt-item"]')].map((r) => r.textContent || '');
      return rows.length > 0 && rows.every((t) => !t.includes('Code review') && !t.includes('SQL explain'));
    }, null, { timeout: 8000 });
    await page.getByTestId('prompt-library').getByRole('button', { name: 'Все' }).click();
  });

  await check('S6 row opens workbench route', async () => {
    await page.locator('[data-testid="prompt-item"]', { hasText: 'SQL explain' }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/sql'), null, { timeout: 8000 });
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('SQL explain'), 'wrong workbench');
  });

  await check('S6 palette enter opens library item', async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('ENT plan');
    await page.locator('[data-testid^="palette-item-"]', { hasText: 'ENT plan' }).first().waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ent'), null, { timeout: 8000 });
  });

  await check('S6 badges read type origin', async () => {
    await page.getByTestId('nav-prompt').click();
    const t = await page.getByTestId('prompt-library').innerText();
    assert(t.includes('Картинка') && t.includes('Встроенный'), 'no type/origin badges: ' + t.slice(0, 160));
    assert(t.includes('Мой') && t.includes('Сохранённый'), 'no mine/saved badges: ' + t.slice(0, 160));
  });

  await check('Library search reads the whole template body and every word, like Ctrl+K', async () => {
    await page.getByTestId('nav-prompt').click();
    const search = page.getByTestId('prompt-search');
    await search.waitFor();
    const only = (title) => page.waitForFunction((t) => {
      const rows = [...document.querySelectorAll('[data-testid="prompt-item"]')];
      return rows.length === 1 && (rows[0].textContent || '').includes(t);
    }, title, { timeout: 5000 });
    await search.fill('зебраслово');
    await only('Long brief');
    await search.fill('brief long');
    await only('Long brief');
    await search.fill('');
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('зебраслово');
    await page.locator('[data-testid^="palette-item-"]', { hasText: 'Long brief' }).first().waitFor();
    await page.keyboard.press('Escape');
  });
};
