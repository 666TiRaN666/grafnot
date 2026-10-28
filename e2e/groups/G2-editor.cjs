// E2E group G2-editor (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G2-editor: editor, tasks, calendar (one empty note) ----------
  await beginGroup('G2-editor', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('n1', 'Old')], 'n1') },
  }));

  await check('P6 cursor order Hi', async () => {
    const ed = page.locator('.tiptap');
    await ed.click();
    await page.keyboard.type('H');
    await page.keyboard.type('i');
    const txt = await ed.innerText();
    assert(txt.includes('Hi'), `order broken, got: ${txt}`);
    const off = await page.evaluate(() => window.getSelection()?.anchorOffset ?? -1);
    assert(off === 2, `caret offset ${off}, want 2`);
  });
  await check('P6 bold + undo', async () => {
    await page.keyboard.press('Control+a');
    await page.getByTitle('Bold').click();
    const html = await page.locator('.tiptap').innerHTML();
    assert(html.includes('<strong>'), 'no bold applied');
    // S3: the one-letter toolbar is gone; bold lives in the selection menu,
    // undo on the keyboard.
    await page.keyboard.press('Control+z');
    const html2 = await page.locator('.tiptap').innerHTML();
    assert(!html2.includes('<strong>'), 'undo did not revert');
  });
  await check('P6 title Alpha', async () => {
    await page.locator('.g-title-in').fill('Alpha');
  });

  // ---------- P1: tasks separate + noteId (S4: filed at once, no dialog) ----------
  await check('P1 task from selection filed with note', async () => {
    await page.locator('.tiptap p').click();
    await page.waitForFunction(() => !!document.activeElement?.classList?.contains('tiptap'), null, { timeout: 8000 });
    await page.keyboard.press('Control+a');
    await page.getByTitle('+ Задача').click();
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.getByTestId('ctx-tab-tasks').click();
    await page.locator('.g-note-tasks').waitFor();
    const t = await page.locator('.g-note-tasks').innerText();
    assert(t.includes('(1)') && t.includes('Hi'), 'task not filed: ' + t.slice(0, 120));
  });
  await check('P1b edit task desc in panel', async () => {
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'Hi' }).click();
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-desc').fill('mydesc2');
    await page.keyboard.press('Tab');
    const row = page.locator('.g-taskline', { hasText: 'Hi' });
    await row.waitFor();
    assert((await row.innerText()).includes('mydesc2'), 'desc missing');
  });
  await check('P1 chip back to note', async () => {
    await page.getByTestId('nav-plan').click();
    const row = page.locator('.g-taskline', { hasText: 'Hi' });
    await row.waitFor();
    const chip = row.locator('.g-src');
    assert((await chip.innerText()).includes('из:'), 'no source chip');
    await chip.click();
    await page.locator('.g-title-in').waitFor();
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Alpha', `opened wrong note: ${v}`);
  });

  // ---------- P2: week calendar ----------
  const todayISO = await page.evaluate(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await check('P2 add dated task', async () => {
    await page.getByTestId('nav-plan').click();
    // S4: vertical composer; the date picker hides behind «Выбрать дату…».
    await page.getByTestId('task-composer').click();
    await page.locator('.g-addtask input').first().fill('Cal task');
    await page.getByRole('button', { name: /Выбрать дату|Pick a date|Күнді/ }).click();
    await page.locator('.g-addtask input[type="date"]').fill(todayISO);
    await page.getByRole('button', { name: 'Добавить' }).click();
    await page.locator('.g-taskline', { hasText: 'Cal task' }).waitFor();
  });
  await check('P2 week grid + toggle', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('plan-view-week').click();
    // P4: the week chunk loads lazily; counting before it mounts reads 0.
    await page.getByTestId('plan-week').waitFor();
    assert((await page.locator('.g-day').count()) === 7, 'not 7 days');
    await page.locator('.g-taskchip', { hasText: 'Cal task' }).waitFor();
    const chip = page.locator('.g-taskchip', { hasText: 'Cal task' });
    // S5: the chip opens the panel; only its checkbox toggles done.
    await chip.locator('xpath=..').locator('input[type="checkbox"]').click();
    assert((await chip.getAttribute('class'))?.includes('done') ?? false, 'toggle failed');
  });
};
