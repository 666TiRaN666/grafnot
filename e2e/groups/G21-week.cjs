// E2E group G21-week (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, check, assert, page } = t;

  // ---------- GROUP G21-week: S5 day cells, popup, chips, drag, inbox ----------
  await beginGroup('G21-week', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: (() => {
        // T2: Monday-anchored markers (expand inside the page): always in-week.
        const tk = (id, text, extra) => Object.assign({ id, text, done: false }, extra || {});
        return v5store([], 'p1', { tasks: [
          tk('w1', 'Inbox item'),
          tk('w2', 'Today item', { due: '@mon+2' }),
          tk('w3', 'Tomorrow item', { due: '@mon+3' }),
        ] });
      })(),
    },
  }));
  // T2: Monday of the DISPLAYED week, computed INSIDE the page with
  // independent arithmetic ((getDay()+6)%7) — never Node-side today+N.
  const pageDayISO = (off) => page.evaluate((n) => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, off);

  await check('S5 cell add opens popup focused', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    const iso = await pageDayISO(3);
    await page.getByTestId(`day-cell-${iso}`).waitFor();
    // The whole empty cell area opens the popup; the pinned strip (revealed
    // on hover/focus, always on touch) is the deterministic click target.
    await page.getByTestId(`day-cell-${iso}`).hover();
    await page.getByTestId(`day-add-${iso}`).click();
    await page.getByTestId('day-popup').waitFor();
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'day-popup-title', 'title not focused');
  });

  await check('S5 popup enter adds keeps open', async () => {
    await page.getByTestId('day-popup-title').fill('Series task');
    await page.keyboard.press('Enter');
    await page.locator('.g-taskchip', { hasText: 'Series task' }).waitFor();
    assert((await page.getByTestId('day-popup').count()) === 1, 'popup closed after add');
    assert((await page.evaluate(() => (document.activeElement || {}).getAttribute?.('data-testid'))) === 'day-popup-title', 'focus left popup');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('day-popup').count()) === 0, 'popup not closed');
  });

  await check('S5 chip opens panel', async () => {
    await page.locator('.g-taskchip', { hasText: 'Today item' }).click();
    await page.getByTestId('task-panel').waitFor();
    assert((await page.getByTestId('task-panel-title').inputValue()) === 'Today item', 'wrong task in panel');
    await page.getByTestId('task-panel-close').click();
  });

  await check('S5 drag moves task with undo', async () => {
    const chip = page.locator('.g-taskchip', { hasText: 'Today item' });
    await chip.waitFor();
    const from = await chip.boundingBox();
    const targetISO = await pageDayISO(4);
    const cell = page.getByTestId(`day-cell-${targetISO}`);
    await cell.waitFor();
    const to = await cell.boundingBox();
    assert(!!from && !!to, 'no geometry');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 30, { steps: 10 });
    await page.mouse.up();
    await page.locator(`[data-testid="day-cell-${targetISO}"] .g-taskchip`, { hasText: 'Today item' }).waitFor();
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    const backISO = await pageDayISO(2);
    await page.locator(`[data-testid="day-cell-${backISO}"] .g-taskchip`, { hasText: 'Today item' }).waitFor();
  });

  await check('S5 inbox shows undated', async () => {
    await page.getByTestId('week-inbox').waitFor();
    assert((await page.getByTestId('week-inbox').innerText()).includes('Inbox item'), 'undated not in inbox');
  });

  await check('S5 header nav moves week', async () => {
    const firstBefore = await page.locator('.g-day-head strong').first().innerText();
    await page.getByLabel('›').click();
    await page.waitForFunction(
      (prev) => document.querySelector('.g-day-head strong')?.textContent !== prev,
      firstBefore, { timeout: 8000 },
    );
    await page.getByLabel('‹').click();
    await page.waitForFunction(
      (prev) => document.querySelector('.g-day-head strong')?.textContent === prev,
      firstBefore, { timeout: 8000 },
    );
  });
};
