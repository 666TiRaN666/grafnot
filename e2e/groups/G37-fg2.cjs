// E2E group G37-fg2 (run order: e2e/check6.cjs).
// Focus group 29.10, second batch: skills, image templates, map, trash,
// plan due dates and restore. Each check starts from its own fixture.
module.exports = async function (t) {
  const { page, check, assert, seedProfiles, seedNote, v5store, beginGroup, groupActive, reseed } = t;
  const seed = (extra) => seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
    stores: { p1: v5store([
      seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body', linkedIds: ['b'], updated: 3 }),
      seedNote('b', 'Beta', { content: '<p>beta body</p>', text: 'beta body', updated: 2 }),
      seedNote('c', 'Gamma', { linkedIds: ['a'], updated: 1 }),
    ], 'a', Object.assign({ graphs: [{ id: 'g1', title: 'Course', noteIds: ['b'] }] }, extra || {})) },
  });
  await beginGroup('G37-fg2', seed());
  if (!await groupActive('G37-fg2')) return;
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
  const waitStored = (fn, arg, why) => page.waitForFunction(([src, a]) => {
    // eslint-disable-next-line no-new-func
    return new Function('s', 'a', 'return (' + src + ')(s, a)')(JSON.parse(localStorage.getItem('grafnot-store-p1')), a);
  }, [fn.toString(), arg], { timeout: 8000 }).catch(() => { throw new Error(why); });

  await check('FG2 skill file language is its own, AGENTS keeps «when», Ctrl+S saves', async () => {
    await reseed(page, seed());
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-new').click();
    await page.getByTestId('prompt-new-skill').click();
    await page.getByTestId('skill-name').fill('helper');
    await page.getByTestId('skill-desc').fill('Helps with text');
    await page.getByTestId('skill-when').fill('the user asks for help');
    await page.getByTestId('skill-steps').fill('Read the request');
    await page.getByTestId('skill-lang-EN').click();
    const md = await page.getByTestId('skill-preview').innerText();
    assert(md.includes('## Instructions') && md.includes('Use when the user asks for help'), 'file followed the interface language: ' + md.slice(0, 200));
    await page.getByTestId('skill-format-agents').click();
    assert((await page.getByTestId('skill-preview').innerText()).includes('When to use: the user asks for help.'), 'AGENTS.md dropped «when to use»');
    await page.getByTestId('skill-desc').focus();
    await page.keyboard.press('Control+s');
    await waitStored((s) => s.customTpls.some((x) => x.kind === 'skill' && x.name === 'helper' && x.skill.lang === 'EN' && x.skill.format === 'agents'), null, 'Ctrl+S did not save the skill with its language');
  });

  await check('FG2 image: Pony prefix on for a new prompt, named template, built-in edits are not lost silently', async () => {
    await reseed(page, seed());
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-new').click();
    await page.getByTestId('prompt-new-image').click();
    assert(await page.getByTestId('pony-score').isChecked(), 'new image prompt starts without the Pony prefix');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).first().click();
    await page.getByTestId('tag-input').fill('red hat');
    await page.keyboard.press('Enter');
    await page.getByTestId('img-builtin-dirty').waitFor();
    await page.getByTestId('img-tpl-name').fill('My hero');
    await page.getByTestId('img-save-tpl').click();
    await waitStored((s) => s.customTpls.some((x) => x.kind === 'image' && x.name === 'My hero' && x.tokens.includes('red hat')), null, 'template not saved under the typed name');
    await page.getByTestId('nav-prompt').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'Арт: персонаж' }).first().click();
    await page.getByTestId('tag-input').fill('blue scarf');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-notes').click();
    const offer = page.locator('.g-toast', { hasText: 'не сохранены' }).locator('.g-toast-undo');
    await offer.waitFor();
    await offer.click();
    await waitStored((s) => s.customTpls.some((x) => x.kind === 'image' && x.tokens.includes('blue scarf')), null, 'leaving dropped the edits without a way back');
  });

  await check('FG2 map: a dropped note stays, a new graph asks for its name, graphs in the note menu', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/map', { waitUntil: 'networkidle' });
    await page.locator('svg.g-canvas').waitFor();
    const gb = await page.locator('circle.g-vnode[data-id="b"]').boundingBox();
    const sx = gb.x + gb.width / 2, sy = gb.y + gb.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 120, sy + 40, { steps: 10 });
    await page.mouse.up();
    await page.locator('g[data-node="b"][data-pinned="true"]').waitFor({ timeout: 8000 });
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: '+ Новый' }).click();
    const name = page.getByTestId('map-graph-name');
    await name.waitFor();
    assert(await name.evaluate((el) => document.activeElement === el), 'new graph name field not focused');
    await page.keyboard.type('Research');
    await page.keyboard.press('Enter');
    await waitStored((s) => s.graphs.some((g) => g.title === 'Research'), null, 'new graph not named');
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    await page.getByTestId('notes-more').click();
    const items = page.getByTestId('notes-menu-graph');
    assert(await items.count() === 2, 'graphs missing from the note menu');
    await items.filter({ hasText: 'Course' }).click();
    await waitStored((s) => s.graphs.find((g) => g.id === 'g1').noteIds.includes('a'), null, 'note menu did not add to the graph');
    assert(await items.filter({ hasText: 'Course' }).getAttribute('aria-checked') === 'true', 'membership not shown as checked');
  });

  await check('FG2 links counted once everywhere; trash reachable from the list and restore stays there', async () => {
    const gone = Object.assign(seedNote('z', 'Old idea'), { trashedAt: 1 });
    await reseed(page, seed({ trash: [gone] }));
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    // Alpha links to Beta and is linked from Gamma: 2 notes in the list and the header.
    const meta = await page.locator('.g-noterow', { hasText: 'Alpha' }).locator('.g-notemeta').innerText();
    assert(/: 2$/.test(meta.trim()), 'list count: ' + meta);
    assert((await page.getByTestId('ctx-all-links').innerText()).includes('(2)'), 'header count differs from the list');
    const link = page.getByTestId('notes-trash-link');
    assert((await link.innerText()).includes('1'), 'no way into the trash under the list');
    await link.click();
    await page.getByTestId('trash-page').waitFor();
    await page.getByTestId('trash-page').getByRole('button', { name: 'Восстановить' }).first().click();
    await page.locator('.g-toast', { hasText: 'Old idea' }).locator('.g-toast-undo', { hasText: 'Открыть' }).waitFor();
    assert(await page.getByTestId('trash-page').isVisible(), 'restore left the trash page');
  });

  await check('FG2 plan: a due date does not carry to the next task; a task from a note offers its due date', async () => {
    await reseed(page, seed());
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    await page.getByTestId('task-composer-title').fill('First');
    await page.getByTestId('task-due-tomorrow').click();
    await page.getByTestId('task-add').click();
    await page.locator('[data-testid="task-row"]', { hasText: 'First' }).waitFor();
    await page.getByTestId('task-composer-title').fill('Second');
    await page.keyboard.press('Enter');
    await waitStored((s) => s.tasks.some((x) => x.text === 'Second'), null, 'second task not added');
    const s = await stored();
    assert(!!s.tasks.find((x) => x.text === 'First').due && !s.tasks.find((x) => x.text === 'Second').due, 'the first due date stuck to the next task');
    // A fresh page: toasts from the tasks above are gone.
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('editor').getByRole('textbox').click();
    await page.keyboard.press('Control+Alt+t');
    const act = page.locator('.g-toast-undo', { hasText: 'Указать срок' });
    await act.waitFor();
    assert(await page.locator('.g-toast', { hasText: 'Задача добавлена' }).count() === 1, 'task toast shown twice');
    await act.click();
    await page.getByTestId('task-panel').waitFor();
    await page.getByTestId('task-panel-due-tomorrow').click();
    await waitStored((s) => s.tasks.some((x) => x.noteId === 'a' && !!x.due), null, 'task from the note got no due date');
  });

  await check('FG2 restore names the profile after the copy and keeps the language; default name follows the language', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/settings/data', { waitUntil: 'networkidle' });
    await page.getByTestId('lang-EN').click();
    assert((await page.getByTestId('profile-menu-open').getAttribute('title')) === 'Main', 'default profile name not translated');
    const file = JSON.stringify(v5store([seedNote('x', 'Imported', { text: 'imported body' })], 'x'));
    await page.getByTestId('import-file').setInputFiles({ name: 'grafnot-Работа-2026-10-31.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await page.getByTestId('note-item').filter({ hasText: 'Imported' }).waitFor();
    const r = await page.evaluate(() => {
      const reg = JSON.parse(localStorage.getItem('grafnot-profiles-v1'));
      return { name: reg.profiles.find((p) => p.id === reg.activeId).name, lang: localStorage.getItem('grafnot-lang:' + reg.activeId) };
    });
    assert(r.name === 'Работа', 'restored profile named ' + r.name);
    assert(r.lang === 'EN', 'restored profile language ' + r.lang);
  });

  await check('FG3 an existing task is not labelled «New task»; map member lists are labelled in the interface language', async () => {
    await reseed(page, seed({ tasks: [{ id: 't1', text: 'Read chapter', done: false, created: 1 }] }));
    await page.goto(t.URL + '#/plan/list/t1', { waitUntil: 'networkidle' });
    const panel = page.getByTestId('task-panel');
    await panel.waitFor();
    const txt = await panel.innerText();
    assert(!txt.includes('Новая задача'), 'existing task panel says «New task»: ' + txt.slice(0, 80));
    assert(await panel.getByLabel('Название задачи').count() === 1, 'task title field has no Russian name');
    await page.goto(t.URL + '#/map/g1', { waitUntil: 'networkidle' });
    await page.getByTestId('map-tools').waitFor();
    await page.getByTestId('map-tools').getByLabel('Меню').click();
    await page.getByRole('menuitem', { name: 'Состав', exact: true }).click();
    // The 5/10/25/50 buttons say what they count.
    await page.getByRole('group', { name: 'Показывать по' }).waitFor({ timeout: 5000 }).catch(() => { throw new Error('limit buttons unlabelled'); });
    // Edges never strike through a name: every label carries a halo in the canvas colour.
    const halo = await page.locator('.g-vlabel').first().evaluate((el) => { const cs = getComputedStyle(el); return cs.paintOrder + '|' + cs.strokeWidth + '|' + cs.stroke; });
    assert(/stroke/.test(halo.split('|')[0]) && parseFloat(halo.split('|')[1]) >= 3 && !/none/.test(halo.split('|')[2]), 'map labels without a halo: ' + halo);
    const english = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((l) => /^(find |graph title|membership|limit)/.test(l)));
    assert(english.length === 0, 'English aria labels on the map: ' + english.join(', '));
  });

  await check('FG3 tablet: the image result stays on screen while tags are edited, the form stays reachable', async () => {
    const tab = await t.browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(seed()) });
    try {
      const pg = await tab.newPage();
      await pg.goto(t.URL + '#/prompts/art', { waitUntil: 'networkidle' });
      await pg.getByTestId('tag-input').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const res = await pg.getByTestId('prompt-result').boundingBox();
      assert(res && res.y >= 0 && res.y + 24 <= 1180, 'result off screen while editing tags: top ' + (res && Math.round(res.y)));
      const aside = await pg.locator('aside.w-result').boundingBox();
      assert(aside && aside.height <= 1180 * 0.4, 'result covers ' + Math.round(aside.height) + ' px');
      // Scrolled to the end, the result sits after the form: its last control is clear.
      await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await pg.waitForTimeout(100);
      const neg = await pg.getByTestId('neg-preset').boundingBox();
      const cover = await pg.locator('aside.w-result').boundingBox();
      assert(neg && cover && neg.y + neg.height <= cover.y + 1, 'the result covers the negative prompt controls');
    } finally { await tab.close(); }
  });

  await check('FG3 built-in template names follow the interface language', async () => {
    const en = await t.browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: t.storageStateFor(Object.assign({}, seed(), { 'grafnot-lang:p1': 'EN' })) });
    try {
      const pg = await en.newPage();
      await pg.goto(t.URL + '#/prompts', { waitUntil: 'networkidle' });
      const lib = pg.getByTestId('prompt-library');
      await lib.waitFor();
      const names = await pg.getByTestId('prompt-item').allInnerTexts();
      assert(names.some((x) => x.includes('Art: character')) && names.some((x) => x.includes('Skill: code review')), 'English names missing: ' + names.map((x) => x.split('\n')[0]).join(' | '));
      assert(!names.some((x) => /Арт: персонаж|Навык: ревью кода|Структурный промпт/.test(x)), 'Russian built-in names in English');
    } finally { await en.close(); }
  });

  await check('FG3 a long word in a narrow week column wraps instead of being cut', async () => {
    await reseed(page, seed({ tasks: [{ id: 'tw', text: 'Электроэнцефалографический отчёт', done: false, created: 1, due: '@mon+0' }] }));
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      await page.goto(t.URL + '#/plan/week', { waitUntil: 'networkidle' });
      const txt = page.locator('.w-chiptext', { hasText: 'Электро' }).first();
      await txt.waitFor();
      const cut = await txt.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      assert(!cut, 'the long word is cut sideways');
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
};
