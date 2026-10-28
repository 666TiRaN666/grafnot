// E2E group G7-lists (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { MAP_UNLOCK, seedLegacy, reseed, groupActive, check, assert, page } = t;

  // ---------- GROUP G7-lists: legacy list/search/limit seeds (each check reseeds) ----------
  await groupActive('G7-lists');

    await check('P19 notes list N9 search keyboard', async () => {
    await reseed(page, seedLegacy((() => {
      const notes = [];
      for (let i = 1; i <= 12; i++) {
        const n = i < 10 ? '0' + i : '' + i;
        notes.push({ id: 'sn' + i, title: 'Seed Note ' + n, content: '', text: i === 3 ? 'Zebra stripes here' : 'plain body ' + i, linkedIds: [], calcs: [], updated: Date.now() - i * 1000 });
      }
      return { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: 'sn1' };
    })()));
    await page.getByTestId('nav-notes').click();
    // S3/N9: no limit selector; one batch of 50 with an honest counter.
    assert((await page.locator('.g-noterow').count()) === 12, 'N9 batch broken');
    assert((await page.locator('.g-notes-tools').first().locator('..').innerText()).includes('12 из 12'), 'no shown-of counter');
    await page.locator('.g-notes-tools .g-in').fill('zebra');
    assert((await page.locator('.g-noterow').count()) === 1, 'search must narrow first');
    await page.locator('.g-notes-tools .g-in').fill('');
    assert((await page.locator('.g-noterow').count()) === 12, 'clear must restore batch');
    await page.locator('.g-notes-tools .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-title-in').inputValue()) === 'Seed Note 02', 'keyboard opened wrong note');
  });

    await check('P20 tasks search filter limit keyboard', async () => {
    await reseed(page, seedLegacy((() => {
      const tasks = [];
      for (let i = 1; i <= 12; i++) {
        tasks.push({ id: 'st' + i, text: 'Seed task ' + i, done: i > 9, noteId: undefined });
      }
      tasks[0].text = 'Fix login button';
      tasks[10].text = 'Login audit';
      return { schemaVersion: 5, notes: [], tasks, trash: [], trashTasks: [], graphs: [], prompts: [], customTpls: [], activeId: '' };
    })()));
    await page.getByTestId('nav-plan').click();
    await page.locator('.g-taskline').first().waitFor();
    // S4/N9: groups instead of filter/limit segs; done collapsed by default.
    assert((await page.getByTestId('task-group-undated').innerText()).includes('(9)'), 'undated group off');
    assert((await page.getByTestId('task-group-done').innerText()).includes('(3)'), 'done group off');
    await page.locator('.g-notes-tools .g-in').fill('login');
    assert((await page.locator('.g-taskline').count()) === 2, 'search must find both');
    await page.locator('.g-notes-tools .g-in').fill('');
    await page.locator('.g-notes-tools .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press(' ');
    await page.waitForFunction(() => (document.querySelector('[data-testid="task-group-undated"]') || {}).innerText?.includes('(8)'), null, { timeout: 8000 });
    assert((await page.getByTestId('task-group-done').innerText()).includes('(4)'), 'toggled task not in done');
    await page.getByTestId('task-group-done').getByRole('button').first().click();
    await page.locator('.g-taskline', { hasText: 'Fix login button' }).getByTestId('task-row-menu').click();
    await page.getByTestId('task-menu-del').click();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    await page.getByTestId('settings-page').locator('.g-sugg', { hasText: 'Fix login button' }).waitFor();
  });

  await check('P21 graph members search limit checkbox', async () => {
    await page.keyboard.press('Escape');
    await reseed(page, seedLegacy((() => {
      const notes = [];
      for (let i = 1; i <= MAP_UNLOCK; i++) {
        const n = i < 10 ? '0' + i : '' + i;
        notes.push({ id: 'mm' + i, title: 'Member ' + n, content: '', text: '', linkedIds: [], calcs: [], updated: Date.now() - i * 1000 });
      }
      return { schemaVersion: 5, notes, tasks: [], trash: [], trashTasks: [], graphs: [{ id: 'g1', title: 'Team', noteIds: ['mm1'] }], prompts: [], customTpls: [], activeId: 'mm1' };
    })()));
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Состав' }).click();
    await page.getByTestId('map-members').waitFor();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 10, 'members not listed');
    await page.locator('[data-testid="map-members"] .g-seg').getByRole('button', { name: '5', exact: true }).click();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 5, 'member limit broken');
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 10, 'member show more broken');
    await page.locator('[data-testid="map-members"] .g-in').fill('Member 03');
    assert((await page.locator('[data-testid="map-members"] .g-memberrow').count()) === 1, 'member search broken');
    const box = page.locator('[data-testid="map-members"] .g-memberrow input');
    assert((await box.isChecked()) === false, 'already a member');
    await box.check();
    assert((await box.isChecked()) === true, 'checkbox toggle broken');
    await box.uncheck();
    await page.locator('[data-testid="map-members"] .g-in').fill('');
    await page.locator('[data-testid="map-members"] .g-in').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const box2 = page.locator('[data-testid="map-members"] .g-memberrow input').nth(1);
    assert((await box2.isChecked()) === true, 'keyboard toggle broken');
  });
};
