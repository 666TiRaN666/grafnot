// E2E group G23-wb (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, browser, storageStateFor, seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G23-wb: S7 text-template workbench + result panel ----------
  await beginGroup('G23-wb', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('n1', 'Note-A', { updated: 2000 }),
          seedNote('n2', 'Note-B', { updated: 1000 }),
        ],
        'n1',
        {
          customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
          prompts: [],
        },
      ),
    },
  }));
  const openWorkbench = async (name) => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: name }).click();
    await page.getByTestId('prompt-workbench').waitFor();
  };

  await check('S7 form vertical required', async () => {
    await openWorkbench('Code review');
    const ys = [];
    for (const name of ['язык', 'уровень', 'код']) {
      const box = await page.getByLabel(name).boundingBox();
      assert(!!box, 'no field ' + name);
      ys.push(box.y);
    }
    assert(ys[0] < ys[1] && ys[1] < ys[2], 'form not vertical');
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('*'), 'required not marked');
  });

  await check('S7 autofocus enter nav', async () => {
    await openWorkbench('Code review');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'код', null, { timeout: 8000 });
    await page.getByLabel('язык').click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'уровень', null, { timeout: 8000 });
    // UX-02: block slots are textareas — Enter breaks the line, Ctrl+Enter copies.
    await page.getByLabel('код').fill('SELECT 1');
    await page.keyboard.press('Enter');
    assert((await page.getByLabel('код').inputValue()) === 'SELECT 1\n', 'Enter did not break the line');
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S7 preview live click field', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('stars');
    await page.waitForFunction(() => (document.querySelector('[data-testid="prompt-result"]') || {}).innerText?.includes('stars'), null, { timeout: 8000 });
    await openWorkbench('Code review');
    await page.getByTestId('prompt-result').getByText('{{код}}').click();
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'код', null, { timeout: 8000 });
  });

  await check('S7 validation only after attempt', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('');
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Не заполнено') === false, 'error before attempt');
    await page.getByTestId('copy-prompt').click();
    await page.getByTestId('prompt-workbench', { hasText: 'Не заполнено' }).waitFor();
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('aria-label') === 'what', null, { timeout: 8000 });
  });

  await check('S7 save names dated renames in row', async () => {
    await page.getByLabel('what').fill('moons');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const todayDot = await page.evaluate(() => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    });
    const row = page.locator('[data-testid="prompt-item"]', { hasText: `My SQL · ${todayDot}` });
    await row.waitFor();
    await row.getByTestId('prompt-rename').click();
    await page.locator('[data-testid="prompt-item"] input').fill('Moons v2');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Moons v2' }).waitFor();
  });

  await check('S7 note chip binds unbinds with undo', async () => {
    await openWorkbench('My SQL');
    await page.getByLabel('what').fill('comets');
    await page.getByRole('button', { name: /В заметку/ }).click();
    await page.locator('[data-testid^="w-note-pick-"]', { hasText: 'Note-A' }).click();
    await page.locator('.g-toasts', { hasText: 'Вставлено в заметку' }).waitFor();
    const chip = page.locator('.w-notechip', { hasText: 'Note-A' });
    await chip.waitFor();
    await chip.getByRole('button', { name: 'Отвязать' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('.w-notechip').count()) === 0, 'chip not cleared');
    await page.locator('.g-toast-undo').click();
    await page.locator('.w-notechip', { hasText: 'Note-A' }).waitFor();
  });

  await check('S7 more duplicates deletes with undo', async () => {
    const exactTitle = (t) => page.locator('.pl-title', { hasText: new RegExp(`^${t}$`) });
    await openWorkbench('My SQL');
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Дублировать' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.pl-title')].filter((el) => el.textContent === 'My SQL').length === 2, null, { timeout: 8000 });
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My SQL' }).first().click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('prompt-wb-more').click();
    await page.getByRole('menuitem', { name: 'Удалить' }).click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await exactTitle('My SQL').count()) === 1, 'not deleted');
    await page.locator('.g-toast-undo').click();
    assert((await exactTitle('My SQL').count()) === 2, 'undo did not restore');
  });

  // UX-02: pasted code keeps its line breaks and indents end to end.
  const PY = 'def greet(name):\n    if name:\n        return "Hello " + name\n    return "Hello"';
  const SQL = 'SELECT name,\n       COUNT(*)\nFROM users\nGROUP BY name';
  const stubClipboard = () => page.evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = async (s) => { window.__copied = s; };
  });

  await check('F2 code field keeps Python lines: field, preview, copy, save, note', async () => {
    await openWorkbench('Code review');
    await stubClipboard();
    await page.getByLabel('язык').fill('Python');
    await page.getByLabel('код').fill(PY);
    assert((await page.getByLabel('код').inputValue()) === PY, 'field lost lines');
    assert((await page.getByTestId('prompt-result').innerText()).includes(PY), 'preview lost lines');
    await page.getByLabel('код').press('Control+Enter');
    await page.waitForFunction(() => typeof window.__copied === 'string', null, { timeout: 8000 });
    assert((await page.evaluate(() => window.__copied)).endsWith('\n' + PY), 'clipboard lost lines');
    await page.getByRole('button', { name: /В заметку/ }).click();
    await page.locator('[data-testid^="w-note-pick-"]', { hasText: 'Note-B' }).click();
    await page.locator('.g-toasts', { hasText: 'Вставлено в заметку' }).waitFor();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const saved = page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).first();
    await saved.waitFor();
    await page.getByTestId('nav-notes').click();
    await page.evaluate(() => { window.location.hash = '#/notes/n2'; });
    await page.locator('.tiptap', { hasText: 'def greet' }).waitFor();
    const noteText = await page.locator('.tiptap').innerText();
    assert(noteText.includes(PY), 'note lost lines: ' + JSON.stringify(noteText.slice(-120)));
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).first().click();
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByLabel('код').inputValue()) === PY, 'saved version lost lines');
  });

  await check('F2 multi-line SQL keeps lines', async () => {
    await openWorkbench('SQL explain');
    await page.getByLabel('запрос').fill(SQL);
    assert((await page.getByLabel('запрос').inputValue()) === SQL, 'field lost lines');
    assert((await page.getByTestId('prompt-result').innerText()).includes(SQL), 'preview lost lines');
  });

  await check('F2 mobile 390 code field keeps lines', async () => {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      storageState: storageStateFor(seedProfiles({
        profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
        activeId: 'p1',
        stores: { p1: v5store([seedNote('n1', 'Note-A')], 'n1', { prompts: [] }) },
      })),
    });
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-prompts').click();
      await m.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).click();
      await m.getByTestId('prompt-workbench').waitFor();
      await m.getByLabel('код').fill(PY);
      assert((await m.getByLabel('код').inputValue()) === PY, 'mobile field lost lines');
      assert((await m.getByTestId('prompt-result').innerText()).includes(PY), 'mobile preview lost lines');
    } finally {
      await m.close();
      await ctx.close();
    }
  });
};
