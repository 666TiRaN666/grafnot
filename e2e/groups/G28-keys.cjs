// E2E group G28-keys (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G28-keys: S12 shortcuts registry matrix ----------
  // Every SHORTCUTS entry in src/shortcuts.ts is exercised here.
  await beginGroup('G28-keys', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { text: 'alpha body', updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          trash: [{ id: 'x1', title: 'Old', content: '', text: '', linkedIds: [], calcs: [], updated: 1, trashedAt: 1 }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
        },
      ),
    },
  }));
  const activeTestid = () => page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'));

  await check('S12 keys page lists the 30 registry rows', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 30, 'keys rows != registry');
  });

  await check('S12 Ctrl+K opens palette, Esc closes', async () => {
    await page.getByTestId('nav-notes').click();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="palette"]'), null, { timeout: 8000 });
  });

  await check('S12 Alt+0 resets panels', async () => {
    await page.getByTestId('nav-notes').click();
    assert((await page.getByTestId('ctx-panel').count()) === 0, 'context is not closed by default');
    await page.locator('.s-rail').getByLabel('Меню').click();
    await page.keyboard.press('Alt+0');
    assert((await page.locator('.s-rail.collapsed').count()) === 0, 'sidebar not reset');
    assert((await page.getByTestId('ctx-panel').count()) === 0, 'context reset must be closed');
  });

  await check('S12 Ctrl+Alt+N creates a note', async () => {
    await page.getByTestId('nav-notes').click();
    const before = await page.getByTestId('note-item').count();
    await page.keyboard.press('Control+Alt+n');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="note-item"]').length === n + 1, before, { timeout: 8000 });
    assert((await page.getByTestId('title-in').inputValue()) === '', 'shortcut created an automatic title');
    assert(await page.getByTestId('editor').getByRole('textbox').evaluate(el => document.activeElement === el), 'shortcut did not focus note body');
  });

  await check('S12 slash focuses notes search', async () => {
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('notes-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'notes-search', 'notes search not focused');
  });

  await check('S12 N creates a note in notes', async () => {
    await page.getByTestId('nav-notes').click();
    const before = await page.getByTestId('note-item').count();
    await page.keyboard.press('n');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="note-item"]').length === n + 1, before, { timeout: 8000 });
    assert((await page.getByTestId('title-in').inputValue()) === '', 'shortcut created an automatic title');
    assert(await page.getByTestId('editor').getByRole('textbox').evaluate(el => document.activeElement === el), 'shortcut did not focus note body');
  });

  await check('S12 plan slash and N', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'task-search', 'plan search not focused');
    await page.getByTestId('nav-plan').click();
    await page.keyboard.press('n');
    assert((await activeTestid()) === 'task-composer-title', 'composer not focused');
  });

  await check('S12 Enter opens task panel, button closes', async () => {
    await page.getByTestId('nav-plan').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run task' }).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-close').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="task-panel"]'), null, { timeout: 8000 });
  });

  await check('S12 Delete removes task, Undo restores', async () => {
    await page.getByTestId('nav-plan').click();
    const row = page.locator('[data-testid="task-row"]', { hasText: 'Today run task' });
    await row.focus();
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-testid="task-row"]')].some((r) => (r.textContent || '').includes('Today run task')), null, { timeout: 8000 });
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run task' }).waitFor();
  });

  await check('S12 week arrows move, T returns', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const first = () => page.locator('[data-testid^="day-cell-"]').first().getAttribute('data-testid');
    const was = await first();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') !== w, was, { timeout: 8000 });
    await page.keyboard.press('t');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') === w, was, { timeout: 8000 });
  });

  await check('S12 slash focuses map search', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'map-search', 'map search not focused');
  });

  await check('S12 slash focuses library search', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').waitFor();
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'prompt-search', 'library search not focused');
  });

  await check('S12 N opens the «New» menu in prompts, Esc closes it back to its button', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').waitFor();
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('n');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'prompt-new-text', null, { timeout: 8000 });
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('prompt-new-text').count()) === 0 && (await activeTestid()) === 'prompt-new', 'menu did not close to its button');
  });

  await check('S12 slash focuses trash search; Esc leaves any list search', async () => {
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('notes-search').waitFor();
    await page.keyboard.press('/');
    await page.keyboard.press('Escape');
    assert((await activeTestid()) !== 'notes-search', 'Esc kept the caret in notes search');
    await page.evaluate(() => { window.location.hash = '#/trash'; });
    await page.getByTestId('trash-search').waitFor();
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('/');
    assert((await activeTestid()) === 'trash-search', 'trash search not focused');
    await page.keyboard.press('Escape');
    assert((await activeTestid()) !== 'trash-search', 'Esc kept the caret in trash search');
  });

  await check('S12 Ctrl+Shift+F inserts a field', async () => {
    await page.evaluate(() => { window.location.hash = '#/prompts/new'; });
    await page.getByTestId('prompt-builder').waitFor();
    await page.getByTestId('builder-body').fill('X ');
    await page.keyboard.press('Control+Shift+f');
    await page.waitForFunction(() => (document.querySelector('[data-testid="builder-body"]') || {}).value?.includes('{{поле_1}}'), null, { timeout: 8000 });
  });

  await check('S12 Ctrl+Enter copies the result', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'My SQL' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('what').fill('moons');
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S12 [[ links a note, Ctrl+click opens it; Ctrl+S saves a template; Alt+arrows move a tag', async () => {
    await page.evaluate(() => { window.location.hash = '#/notes/a1'; });
    await page.waitForFunction(() => document.querySelector('[data-testid="title-in"]')?.value === 'Alpha', null, { timeout: 8000 });
    await page.getByTestId('editor').getByRole('textbox').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' [[Bet');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await page.locator('[data-wikilink="Beta"]').first().click({ modifiers: ['Control'] });
    await page.waitForFunction(() => location.hash === '#/notes/b1', null, { timeout: 8000 });
    await page.evaluate(() => { window.location.hash = '#/prompts/new'; });
    await page.getByTestId('prompt-builder').waitFor();
    await page.getByTestId('builder-name').fill('Keys probe');
    await page.getByTestId('builder-body').fill('Hello {{who}}');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => (JSON.parse(localStorage.getItem('grafnot-store-p1') || '{}').customTpls || []).some((x) => x.name === 'Keys probe'), null, { timeout: 8000 });
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).click();
    await page.getByTestId('tag-input').fill('green eyes');
    await page.keyboard.press('Enter');
    const look = () => page.getByTestId('lane-look').locator('[data-testid="tag-chip"]').allInnerTexts();
    await page.getByTestId('lane-look').locator('[data-testid="tag-chip"]', { hasText: 'green eyes' }).waitFor();
    const before = await look();
    assert(before.length >= 2 && before[before.length - 1].includes('green eyes'), 'look lane: ' + before.join('|'));
    await page.getByTestId('lane-look').locator('[data-testid="tag-chip"]', { hasText: 'green eyes' }).click();
    await page.keyboard.press('Alt+ArrowLeft');
    const after = await look();
    assert(after[after.length - 2].includes('green eyes'), 'Alt+Left did not move the tag: ' + after.join('|'));
  });

  await check('S12 shortcuts work in a Russian/Kazakh layout, Ctrl+Alt+N also from the text', async () => {
    // A Cyrillic layout reports the letter it types (key 'л' for K) and the physical key in code.
    const press = (key, code, mods = {}) => page.evaluate(([k, c, m]) => {
      const el = document.activeElement || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true, ...m }));
    }, [key, code, mods]);
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('note-item').first().waitFor();
    await press('л', 'KeyK', { ctrlKey: true });
    await page.getByTestId('palette').waitFor({ timeout: 5000 }).catch(() => { throw new Error('Ctrl+K (л) did not open the palette'); });
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-search').waitFor();
    await press('т', 'KeyN');
    assert((await activeTestid()) === 'task-composer-title', 'N (т) did not focus the task composer');
    await page.getByTestId('plan-view-week').click();
    const first = () => page.locator('[data-testid^="day-cell-"]').first().getAttribute('data-testid');
    const was = await first();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') !== w, was, { timeout: 8000 });
    await press('е', 'KeyT');
    await page.waitForFunction((w) => document.querySelectorAll('[data-testid^="day-cell-"]')[0]?.getAttribute('data-testid') === w, was, { timeout: 5000 })
      .catch(() => { throw new Error('T (е) did not return to this week'); });
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('note-item').first().click();
    await page.getByTestId('editor').getByRole('textbox').click();
    const before = await page.getByTestId('note-item').count();
    await press('т', 'KeyN', { ctrlKey: true, altKey: true });
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="note-item"]').length === n + 1, before, { timeout: 5000 })
      .catch(() => { throw new Error('Ctrl+Alt+N from the text created no note'); });
  });

  await check('2026-11 keys: Tab/Shift+Tab/Esc in the text, list selection, map box', async () => {
    // note-indent / note-leave: repeated Tab keeps the focus, Esc leaves the text, Tab then moves on.
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    const body = page.getByTestId('editor').getByRole('textbox');
    await body.click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
    await page.keyboard.press('Control+Home');
    // The block indent level (not characters): also on this empty first line.
    const level = () => page.evaluate(() => Number(document.querySelector('.tiptap p')?.getAttribute('data-indent') || 0));
    for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
    assert(await body.evaluate((el) => document.activeElement === el), 'repeated Tab left the text');
    assert((await level()) === 3, 'three Tabs did not indent three times');
    assert(!(await page.evaluate(() => (document.querySelector('.tiptap p')?.textContent || '').includes('\t'))), 'Tab typed characters');
    await page.waitForTimeout(600);
    await page.keyboard.press('Shift+Tab');
    assert((await level()) === 2, 'Shift+Tab did not outdent');
    await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(() => Number(document.querySelector('.tiptap p')?.getAttribute('data-indent') || 0) === 3, null, { timeout: 5000 });
    // note-find: Ctrl+F from the text opens find; Esc returns to the text.
    await page.keyboard.press('ControlOrMeta+f');
    await page.getByTestId('find-input').waitFor();
    assert((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'find-input', 'Ctrl+F did not focus find');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="find-bar"]') && document.activeElement?.classList.contains('ProseMirror'), null, { timeout: 5000 });
    await page.keyboard.press('Escape');
    assert(await page.getByTestId('editor').evaluate((el) => document.activeElement === el), 'Esc did not leave the text');
    await page.keyboard.press('Tab');
    assert(!(await body.evaluate((el) => document.activeElement === el)), 'Tab after Esc went back into the text');
    // sel-toggle / sel-range / sel-all / sel-clear in the notes list.
    const items = page.getByTestId('note-item');
    const n = await items.count();
    await items.nth(n - 1).click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('notes-sel-bar').waitFor();
    await items.nth(0).click({ modifiers: ['Shift'] });
    const checked = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="note-check"]')].filter((c) => c.checked).length);
    assert((await checked()) === n, 'Shift+click did not select the range');
    await items.first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    assert((await checked()) === n, 'Ctrl+A did not select the list');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="notes-sel-bar"]'), null, { timeout: 5000 });
    // map-box: Shift+drag on the canvas draws a box (no pan).
    await page.getByTestId('nav-map').click();
    const canvas = page.locator('svg.g-canvas');
    await canvas.waitFor();
    await page.locator('[aria-label="Вписать"]').click();
    await page.waitForTimeout(400);
    const b = await canvas.boundingBox();
    const before = await page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'));
    await page.keyboard.down('Shift');
    await page.mouse.move(b.x + 4, b.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 4, b.y + b.height - 4, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    assert((await page.locator('circle.g-vnode.sel').count()) === (await page.locator('circle.g-vnode').count()), 'Shift+drag did not box-select');
    assert((await page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'))) === before, 'Shift+drag panned the map');
    await page.keyboard.press('Escape');
  });

  await check('S12 KZ keys layout has no overflow', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByRole('button', { name: 'Қазақша', exact: true }).click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 30, 'keys rows missing in KZ');
    const bad = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth <= window.innerWidth + 1 ? null : `${de.scrollWidth}>${window.innerWidth}`;
    });
    assert(bad === null, `horizontal overflow in KZ keys: ${bad}`);
  });
};
