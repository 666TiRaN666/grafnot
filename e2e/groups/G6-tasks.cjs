// E2E group G6-tasks (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, seedLegacy, v5store, seedNote, reseed, beginGroup, check, assert, page } = t;

  // ---------- GROUP G6-tasks: settings, snippets, trash, adopted tasks (one Probe note) ----------
  await beginGroup('G6-tasks', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([seedNote('pn', 'Probe')], 'pn') },
  }));

    await check('P15 settings panel real', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-page').waitFor();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).waitFor();
    const t = await page.getByTestId('settings-page').innerText();
    assert(t.includes('Тема') || t.includes('Theme') || t.includes('Тақырып'), `no labels: ${t}`);
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'theme not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'Светлая', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'light', 'theme not reverted');
    // S9: the prompts limit control is gone (N9 batches); lists persist via listPrefs (unit-tested).
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('settings-page').waitFor({ state: 'detached' });
    assert((await page.getByTestId('settings-page').count()) === 0, 'settings page stuck');
  });

    await check('P16 note snippets termed заготовки', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.getByTestId('ctx-tab-snip').click();
    const panel = await page.locator('.g-right').innerText();
    assert(panel.includes('Заготовки'), `no snippets title: ${panel}`);
    assert(!panel.includes('Шаблоны'), 'old term present');
    await page.locator('.g-right').getByRole('button', { name: 'Лекция', exact: true }).click();
    await page.locator('.g-toasts', { hasText: 'Заготовка вставлена' }).waitFor();
    await page.locator('.tiptap', { hasText: 'Лекция' }).waitFor();
  });

    await check('P17a task to trash and restore', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    await page.locator('.g-page input[aria-label="new task"]').fill('TrashProbe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
    // S4: immediate delete with Undo instead of arm-confirm.
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.locator('.g-toast-undo').waitFor();
    assert((await page.locator('.g-taskline', { hasText: 'TrashProbe' }).count()) === 0, 'task not trashed');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).waitFor();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).getByRole('button', { name: 'восстановить' }).click();
    assert((await page.locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not restored');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).waitFor();
  });

  await check('P17b purge needs arm confirm', async () => {
    await page.locator('.g-taskline', { hasText: 'TrashProbe' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    const trow = page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' });
    await trow.getByRole('button', { name: 'Удалить навсегда' }).click();
    await page.getByRole('alertdialog').waitFor();
    assert((await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 1, 'purged without confirm');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'TrashProbe' }).count()) === 0, 'task not purged');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().locator('.g-noteopen').click();
    await page.locator('.g-title-in').waitFor();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    const n0 = await page.getByTestId('settings-page').locator('.g-sugg').count();
    await page.getByTestId('settings-page').locator('.g-sugg').first().getByRole('button', { name: 'Удалить навсегда' }).click();
    await page.getByRole('alertdialog').waitFor();
    assert((await page.getByTestId('settings-page').locator('.g-sugg').count()) === n0, 'note purged without confirm');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    assert((await page.getByTestId('settings-page').locator('.g-sugg').count()) === n0 - 1, 'note not purged');
  });

  await check('P17c old store without trashTasks migrates', async () => {
    await reseed(page, seedLegacy({
      schemaVersion: 4,
      notes: [],
      tasks: [{ id: 't1', text: 'Old', done: false }],
      trash: [],
      graphs: [],
      prompts: [],
      customTpls: [],
      activeId: '',
    }));
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline', { hasText: 'Old' }).waitFor();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.muted', { hasText: 'Корзина пуста' }).waitFor();
  });

    await check('P18 ctrl+k finds saved prompt and opens its card', async () => {
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review' }).click();
    await page.getByTestId('prompt-workbench').waitFor();
    await page.getByLabel('код').fill('P18 probe');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Code review ·' }).waitFor();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('code review');
    const res = page.locator('[data-testid^="palette-item-"]', { hasText: 'Code review' });
    await res.first().waitFor();
    assert((await page.getByTestId('palette').innerText()).includes('промпт'), 'no prompt kind');
    await res.first().click();
    // S7: template picks land in the workbench, not the legacy card.
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-workbench').innerText()).includes('Code review'), 'wrong workbench');
  });

  await check('P18b legacy image saves become editable templates', async () => {
    await reseed(page, seedLegacy({
      schemaVersion: 5,
      notes: [{ id: 'n-old', title: 'Legacy note', content: '', text: '', linkedIds: [], calcs: [], updated: 1 }],
      tasks: [],
      trash: [],
      trashTasks: [],
      graphs: [],
      prompts: [{ id: 'p-old', kind: 'image', title: 'Legacy blue art', model: 'SDXL', tokens: ['blue hair'], noteId: 'n-old', created: 1 }],
      customTpls: [],
      activeId: 'n-old',
    }));
    await page.getByTestId('nav-prompt').click();
    // S9: the migrated template + save surface as library rows (no minis).
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Legacy blue art' }).first().waitFor();
    const saveRow = page.locator('[data-testid="prompt-item"]', { hasText: 'Legacy blue art' }).filter({ hasText: 'Сохранённый' });
    await saveRow.click();
    await page.getByTestId('prompt-workbench').waitFor();
    assert((await page.getByTestId('prompt-result').innerText()).includes('(blue hair)'), 'legacy image syntax lost');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'Legacy note' }).first().locator('.g-noteopen').click();
    await page.getByTestId('ctx-tab-prompts').click();
    const prompts = page.locator('.g-card', { hasText: 'Промпты' });
    await prompts.waitFor();
    assert((await prompts.innerText()).includes('Legacy blue art'), 'legacy note link lost');
  });
};
