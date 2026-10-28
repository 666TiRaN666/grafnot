// E2E group G25-builder (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, check, assert, page } = t;

  // ---------- GROUP G25-builder: S9 template constructor ----------
  await beginGroup('G25-builder', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], 'p1') },
  }));
  const openBuilder = async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-library').getByRole('button', { name: '+ Новый шаблон' }).click();
    await page.getByTestId('prompt-builder').waitFor();
  };

  await check('S9 insert field selects name', async () => {
    await openBuilder();
    await page.getByTestId('builder-body').fill('Hello ');
    await page.getByTestId('builder-insert').click();
    assert((await page.getByTestId('builder-body').inputValue()).includes('{{поле_1}}'), 'not inserted');
    assert((await page.evaluate(() => (window.getSelection() || '').toString())) === 'поле_1', 'name not selected');
  });

  await check('S9 fields table live', async () => {
    await page.getByTestId('builder-body').fill('Hi {{city}}');
    await page.getByTestId('builder-field-city').waitFor();
  });

  await check('S9 syntax errors inline', async () => {
    await page.getByTestId('builder-body').fill('ok\nbroken {{oops');
    await page.getByTestId('builder-errors').waitFor();
    assert((await page.getByTestId('builder-errors').innerText()).includes('2'), 'no line number');
    await page.getByTestId('builder-body').fill('{{a}} {{b}}\nagain {{a}}');
    assert((await page.getByTestId('builder-errors').innerText()).includes('a'), 'no duplicate name');
  });

  await check('S9 save creates opens', async () => {
    await page.getByTestId('builder-name').fill('My Tpl');
    await page.getByTestId('builder-body').fill('Hi {{who}}');
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => window.location.hash.includes('#/prompts/ct'), null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My Tpl' }).waitFor();
  });

  await check('S9 type switch image', async () => {
    await openBuilder();
    await page.getByTestId('builder-name').fill('Img T');
    await page.getByTestId('builder-body').fill('a, b');
    await page.getByRole('button', { name: 'Картинка', exact: true }).click();
    await page.getByTestId('prompt-builder').getByRole('button', { name: 'Сохранить', exact: true }).click();
    const row = page.locator('[data-testid="prompt-item"]', { hasText: 'Img T' });
    await row.waitFor();
    assert((await row.innerText()).includes('Картинка'), 'no image badge');
  });
};
