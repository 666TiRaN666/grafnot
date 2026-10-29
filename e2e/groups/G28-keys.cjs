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
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          customTpls: [{ id: 'ct1', name: 'My SQL', body: 'SELECT {{what}}', defaults: {} }],
        },
      ),
    },
  }));
  const activeTestid = () => page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'));

  await check('S12 keys page lists the 16 registry rows', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 16, 'keys rows != registry');
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

  await check('S12 KZ keys layout has no overflow', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByRole('button', { name: 'KZ', exact: true }).click();
    await page.getByTestId('settings-nav-keys').click();
    await page.getByTestId('keys-row').first().waitFor();
    assert((await page.getByTestId('keys-row').count()) === 16, 'keys rows missing in KZ');
    const bad = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth <= window.innerWidth + 1 ? null : `${de.scrollWidth}>${window.innerWidth}`;
    });
    assert(bad === null, `horizontal overflow in KZ keys: ${bad}`);
  });
};
