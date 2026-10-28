// E2E group G29-kpi (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G29-kpi: S13 interaction budgets (minimal sequences) ----------
  const activeTestid = () => page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'));
  await beginGroup('G29-kpi', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { text: 'alpha body one two', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha body one two' }] }] }, updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          customTpls: [{ id: 'ct2', name: 'Clip me', body: 'Run {{cmd}}', defaults: { cmd: 'ls' } }],
        },
      ),
    },
  }));

  await check('S13 new task: N, text, Enter', async () => {
    await page.getByTestId('nav-plan').click();
    // P4: N before the plan chunk attaches its listener is lost silently.
    await page.getByTestId('task-composer').waitFor();
    await page.keyboard.press('n');
    await page.getByTestId('task-composer-title').fill('KPI task');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"]', { hasText: 'KPI task' }).waitFor();
    assert((await activeTestid()) === 'task-composer-title', 'focus left composer (no serial input)');
  });

  await check('S13 day task: cell click, text, Enter', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const cell = page.locator('[data-testid^="day-cell-"]').first();
    await cell.waitFor();
    await cell.click({ position: { x: 8, y: 8 } });
    await page.getByTestId('day-popup-title').fill('KPI day task');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"], [data-testid^="day-cell-"]', { hasText: 'KPI day task' }).first().waitFor();
    assert((await page.getByTestId('day-popup').count()) === 1, 'popup closed (no serial input)');
  });

  await check('S13 prompt copy mouse in 2 clicks', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Clip me' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByTestId('copy-prompt').click();
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S13 prompt copy keyboard: /, query, Enter, Ctrl+Enter', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-search').waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('clip');
    await page.keyboard.press('Enter');
    await page.getByTestId('prompt-workbench', { hasText: 'Clip me' }).waitFor();
    await page.keyboard.press('Control+Enter');
    await page.locator('.g-toasts', { hasText: 'Скопировано' }).waitFor({ timeout: 8000 });
  });

  await check('S13 note switch in 1 click', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Alpha' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value === 'Beta', null, { timeout: 8000 });
  });

  await check('S13 link: [[, query, Enter', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Alpha' }).click();
    await page.locator('.tiptap').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[[Bet');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-right', { hasText: 'Beta' }).waitFor();
  });

  await check('S13 note delete+undo is 1+1', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).waitFor();
  });
};
