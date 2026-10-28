// E2E group G20-plan (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, check, assert, page } = t;

  // ---------- GROUP G20-plan: S4 vertical composer, due chips, row panel, undo delete ----------
  await beginGroup('G20-plan', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: (() => {
        // T2: today-relative markers (expand inside the page, fixed-clock safe).
        const tk = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
        return v5store([], 'p1', { tasks: [
          tk('t1', 'Late bill', { due: '@today-1' }),
          tk('t2', 'Today run', { due: '@today+0' }),
          tk('t3', 'Tomorrow call', { due: '@today+1' }),
          tk('t4', 'Later dream', { due: '@today+10' }),
          tk('t5', 'Free thought'),
          tk('t6', 'Old win', { done: true, due: '@today-2' }),
        ] });
      })(),
    },
  }));
  const tomorrowISO = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });

  await check('S4 composer expands adds keeps focus', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    await page.getByTestId('task-due-today').waitFor();
    await page.getByTestId('task-composer-title').fill('Serial one');
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="task-row"]', { hasText: 'Serial one' }).waitFor();
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'task-composer-title', 'focus left composer');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('task-due-today').count()) === 0, 'not collapsed');
  });

  await check('S4 due chip tomorrow', async () => {
    await page.getByTestId('task-composer').click();
    await page.getByTestId('task-composer-title').fill('Call mom');
    await page.getByTestId('task-due-tomorrow').click();
    await page.getByTestId('task-add').click();
    const chip = page.locator('[data-testid="task-row"]', { hasText: 'Call mom' }).locator('.g-due');
    await chip.waitFor();
    assert((await chip.getAttribute('title')) === tomorrowISO, 'wrong due stamp');
  });

  await check('S4 row opens panel edits title', async () => {
    await page.locator('[data-testid="task-row"]', { hasText: 'Today run' }).click();
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-title').fill('Today run!');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="task-row"]')].some((r) => (r.textContent || '').includes('Today run!')), null, { timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  await check('S4 delete undo restores', async () => {
    const row = page.locator('[data-testid="task-row"]', { hasText: 'Free thought' });
    await row.getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('[data-testid="task-row"]', { hasText: 'Free thought' }).count()) === 0, 'not deleted');
    await page.locator('.g-toast-undo').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'Free thought' }).waitFor();
  });

  await check('S4 groups overdue first', async () => {
    const first = page.locator('[data-testid^="task-group-"]').first();
    await first.waitFor();
    const head = await first.innerText();
    assert(head.includes('1'), 'no overdue count: ' + head.slice(0, 80));
    const lateRow = page.locator('[data-testid="task-row"]', { hasText: 'Late bill' });
    assert(((await lateRow.innerText()).match(/Просрочено|Overdue|Мерзімі/) || [])[0], 'no overdue text marker');
  });

  // UX-01: a palette pick opens the task (panel + deep link), never toggles it.
  const pickTask = async (text, id) => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill(text);
    await page.locator('[data-testid^="palette-item-"]', { hasText: text }).first().waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction((h) => window.location.hash === h, `#/plan/list/${id}`, { timeout: 8000 });
    await page.getByTestId('task-panel').waitFor();
    assert((await page.getByTestId('task-panel-title').inputValue()) === text, 'panel of another task');
    // Earlier undo toasts may still live (8 s): look only for toggle toasts.
    const toasts = await page.evaluate(() => (document.querySelector('.g-toasts') || {}).textContent || '');
    assert(!/Задача выполнена|Задача снова активна/.test(toasts), 'palette pick toggled: ' + toasts);
  };

  await check('F1 palette opens active task without toggling', async () => {
    await page.getByTestId('nav-notes').click();
    await pickTask('Tomorrow call', 't3');
    const row = page.locator('[data-testid="task-row"]', { hasText: 'Tomorrow call' });
    assert(!(await row.locator('.t-check').isChecked()), 'active task got toggled');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.location.hash === '#/plan/list', null, { timeout: 8000 });
  });

  await check('F1 palette opens done task in done group, deep link opens panel', async () => {
    await pickTask('Old win', 't6');
    const row = page.getByTestId('task-group-done').locator('[data-testid="task-row"]', { hasText: 'Old win' });
    await row.waitFor();
    assert(await row.locator('.t-check').isChecked(), 'done task got toggled');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.location.hash = '#/plan/list/t4'; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('task-panel').waitFor();
    assert((await page.getByTestId('task-panel-title').inputValue()) === 'Later dream', 'deep link opened wrong task');
  });
};
