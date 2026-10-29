// First-pass contracts W7-W12. Each check starts from an isolated fixture.
module.exports = async function(t) {
  const { page, check, assert, seedProfiles, seedNote, v5store, beginGroup, groupActive, reseed } = t;
  const seed = () => seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
    stores: { p1: v5store([
      seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body', linkedIds: ['b'], updated: 2 }),
      seedNote('b', 'Beta', { content: '<p>beta body</p>', text: 'beta body', updated: 1 }),
    ], 'a', { graphs: [{ id: 'g1', title: 'Course', noteIds: ['a', 'b'] }], customTpls: [{ id: 'ct1', name: 'Letter', body: 'Hello {{name}}', defaults: {} }] }) },
  });
  await beginGroup('G35-rollout', seed());
  if (!await groupActive('G35-rollout')) return;
  const body = () => page.getByTestId('editor').getByRole('textbox');

  await check('W7 compact context, three tabs and optional reversible calculation', async () => {
    await reseed(page, seed());
    assert(await page.getByTestId('ctx-block').count() === 1, 'compact context block missing');
    assert(await page.getByTestId('ctx-panel').count() === 0, 'context open by default');
    assert(await page.getByTestId('calc-block').count() === 0, 'empty calculations consume space');
    await page.getByTestId('ctx-all-links').click();
    await page.getByTestId('ctx-panel').waitFor();
    assert(await page.getByTestId('ctx-tabs').getByRole('tab').count() === 3, 'context does not have three tabs');
    await page.keyboard.press('Escape');
    assert(await page.getByTestId('ctx-all-links').evaluate(el => document.activeElement === el), 'context close lost its opener');
    await page.getByTestId('insert-open').click();
    await page.getByTestId('insert-item-calc').click();
    await page.getByTestId('calc-block').waitFor();
    assert(await page.getByTestId('calc-name').last().evaluate(el => document.activeElement === el), 'new calculation name not focused');
    await page.getByRole('textbox', { name: 'Формула', exact: true }).fill('2+3*4');
    await page.getByTestId('calc-block').getByText('= 14', { exact: true }).waitFor();
    await page.getByTestId('calc-block').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="calc-block"]'));
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.getByTestId('calc-block').getByText('= 14', { exact: true }).waitFor();
  });

  await check('W8 full text and more expose the 51st palette match', async () => {
    const notes = Array.from({ length: 60 }, (_, i) => seedNote('n' + i, 'Needle ' + i, { text: 'x'.repeat(1000) + ' tailӘ' }));
    await reseed(page, seedProfiles({ profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1', stores: { p1: v5store(notes, 'n0') } }));
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('tailӘ');
    assert(await page.getByTestId('palette-more-notes').count() === 1, 'matching notes beyond four are inaccessible');
    await page.getByTestId('palette-more-notes').click();
    const hit = page.getByTestId('palette-item-50');
    await hit.click();
    await page.waitForFunction(() => location.hash === '#/notes/n50');
  });

  await check('W9 selected-note map route and return restore the note entry', async () => {
    await reseed(page, seed());
    assert(await page.getByTestId('ctx-show-map').count() === 1, 'show-on-map entry missing');
    await page.getByTestId('ctx-show-map').click();
    await page.waitForFunction(() => location.hash === '#/map/note/a');
    await page.getByTestId('map-peek').waitFor();
    assert((await page.getByTestId('map-peek').innerText()).includes('Alpha'), 'wrong selected map note');
    await page.goBack();
    await page.getByTestId('ctx-show-map').waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="ctx-show-map"]'));
    assert((await body().innerText()).includes('alpha body'), 'return lost the editor document');
    await page.goto(t.URL + '#/map/g1', { waitUntil: 'networkidle' });
    assert((await page.getByTestId('map-graphs').innerText()).includes('Course'), 'graph deep link ignored');
  });

  await check('W10 prompt fields insert at a mapped cursor and undo normally', async () => {
    await reseed(page, seed());
    assert(await page.getByTestId('insert-open').count() === 1, 'insert entry missing');
    await body().click();
    await page.keyboard.press('Control+End');
    await page.getByTestId('insert-open').click();
    await page.getByTestId('insert-item-prompt').click();
    await page.getByTestId('prompt-insert-search').fill('Letter');
    await page.getByTestId('prompt-insert-choice').first().click();
    await page.getByTestId('prompt-insert-field-0').fill('World');
    await body().click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('PREFIX ');
    await page.getByTestId('prompt-insert-submit').click();
    await page.waitForFunction(() => {
      const n = JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'a');
      return n.text.startsWith('PREFIX alpha body') && n.text.includes('Hello World');
    });
    await body().click();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !document.querySelector('[data-testid="editor"]').textContent.includes('Hello World'));
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
    assert(s.notes.find(n => n.id === 'b').text === 'beta body', 'insertion changed a different note');
  });

  const openLetter = async (value) => {
    await page.getByTestId('insert-open').click();
    await page.getByTestId('insert-item-prompt').click();
    await page.getByTestId('prompt-insert-search').fill('Letter');
    await page.getByTestId('prompt-insert-choice').first().click();
    await page.getByTestId('prompt-insert-field-0').fill(value);
  };
  const storedNote = (id) => page.evaluate((nid) => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === nid), id);

  await check('W10 cancel returns to the text at the saved caret', async () => {
    await reseed(page, seed());
    await body().click();
    await page.keyboard.press('Control+End');
    await openLetter('World');
    await page.keyboard.press('Escape');
    await page.getByTestId('prompt-insert').waitFor({ state: 'detached' });
    assert(await body().evaluate(el => el === document.activeElement || el.contains(document.activeElement)), 'cancel did not return focus to the text');
    await page.keyboard.type('Z');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'a').text === 'alpha bodyZ');
  });

  await check('W10 leaving the note offers the unsent prompt for copying', async () => {
    await reseed(page, seed());
    await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (s) => { window.__copied = s; }; });
    await body().click();
    await openLetter('World');
    await page.getByTestId('note-item').filter({ hasText: 'Beta' }).click();
    await page.getByRole('button', { name: 'Копировать результат', exact: true }).click();
    await page.waitForFunction(() => window.__copied === 'Hello World');
    await page.getByTestId('note-item').filter({ hasText: 'Alpha' }).click();
    await body().click();
    await openLetter('Moon');
    await page.getByTestId('nav-plan').click();
    await page.getByRole('button', { name: 'Копировать результат', exact: true }).click();
    await page.waitForFunction(() => window.__copied === 'Hello Moon');
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
    assert(s.notes.find(n => n.id === 'a').text === 'alpha body' && s.notes.find(n => n.id === 'b').text === 'beta body', 'an abandoned prompt reached a note');
    assert(!s.prompts.some(p => p.noteId), 'an abandoned prompt was bound');
  });

  await check('W9 return from another section restores caret, scroll and panel', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => 'line ' + i);
    const longSeed = seed(), longStore = JSON.parse(longSeed['grafnot-store-p1']);
    Object.assign(longStore.notes[0], { content: lines.map(l => '<p>' + l + '</p>').join(''), text: lines.join('\n\n') });
    longSeed['grafnot-store-p1'] = JSON.stringify(longStore);
    await reseed(page, longSeed);
    await body().click();
    await page.keyboard.press('Control+End');
    await page.getByTestId('ctx-all-links').click();
    await page.getByTestId('ctx-tab-tasks').click();
    // Clicking the entry scrolled to it; leave from the middle of the note.
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForFunction(() => Math.abs(window.scrollY - 900) < 2);
    const scrolled = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => { location.hash = '#/plan/list'; });
    await page.getByTestId('task-composer').waitFor();
    await page.goBack();
    await page.getByTestId('ctx-panel').waitFor();
    assert(await page.getByTestId('ctx-tab-tasks').getAttribute('aria-selected') === 'true', 'panel tab not restored');
    const back = await page.evaluate(() => window.scrollY);
    assert(Math.abs(back - scrolled) < 8, 'scroll not restored: ' + back + ' vs ' + scrolled);
    await page.keyboard.press('Escape');
    await page.getByTestId('ctx-panel').waitFor({ state: 'detached' });
    await page.keyboard.type('Z');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'a').text.endsWith('line 79Z'));
  });

  await check('W8 palette opens a note with the caret at the first match', async () => {
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
      stores: { p1: v5store([
        seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body', updated: 2 }),
        seedNote('c', 'Gamma', { content: '<p>first line</p><p>second line</p><p>third Иглa here</p>', text: 'first line\n\nsecond line\n\nthird Иглa here', updated: 1 }),
      ], 'a') },
    }));
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('игл');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/notes/c');
    await page.waitForFunction(() => document.activeElement?.closest('[data-testid="editor"]'));
    await page.keyboard.type('Z');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'c').text.includes('third ZИглa here'));
    assert((await storedNote('a')).text === 'alpha body', 'search typing reached another note');
  });

  await check('W12 phone toast keeps its message readable beside the action', async () => {
    const longSeed = seed(), longStore = JSON.parse(longSeed['grafnot-store-p1']);
    longStore.notes[0].title = 'Конспект лекции по взаимодействию человека и компьютера';
    longSeed['grafnot-store-p1'] = JSON.stringify(longStore);
    const ctx = await t.browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(longSeed) });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      await pg.getByTestId('notes-more').click();
      await pg.getByTestId('notes-menu-trash').click();
      const undo = pg.getByRole('button', { name: 'Отменить', exact: true });
      await undo.waitFor();
      const geo = await undo.evaluate((b) => {
        const toast = b.parentElement, msg = toast.firstElementChild.getBoundingClientRect(), box = toast.getBoundingClientRect();
        return { msg: msg.width, left: box.left, right: box.right };
      });
      assert(geo.msg >= 200, 'toast message squeezed to ' + Math.round(geo.msg) + 'px');
      assert(geo.left >= 0 && geo.right <= 375, 'toast leaves the screen');
    } finally { await ctx.close(); }
  });

  await check('W12 mobile create is labelled, contextual and configurable', async () => {
    const mobileSeed = seed(), mobileStore = JSON.parse(mobileSeed['grafnot-store-p1']);
    const longTitle = 'Ұзақ тақырып — исследование связей и задач для следующей лабораторной работы';
    mobileStore.graphs[0].title = longTitle;
    mobileStore.notes[0].title = longTitle;
    mobileStore.tasks = [{ id: 'wide', text: longTitle, desc: 'https://example.test/' + 'longpath'.repeat(50), noteId: 'a', done: false }];
    mobileSeed['grafnot-store-p1'] = JSON.stringify(mobileStore);
    const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(mobileSeed) });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      assert(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'long graph name expands the note viewport');
      await pg.getByTestId('tab-plan').click();
      await pg.getByTestId('task-row').waitFor();
      assert(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'long source or URL expands the plan viewport');
      assert((await pg.getByTestId('tab-add').innerText()).includes('Задача'), 'mobile plus is not contextual or labelled');
      assert(await pg.getByTestId('save-state').isVisible(), 'mobile save status hidden');
      assert(await pg.getByTestId('profile-menu-open').isVisible(), 'mobile profile entry missing');
      await pg.getByTestId('tab-add').click();
      await pg.getByTestId('task-composer-title').waitFor();
      assert(await pg.getByTestId('task-composer-title').evaluate(el => document.activeElement === el), 'mobile task field not focused');
      await pg.evaluate(() => { const v = visualViewport; if (v) { Object.defineProperty(v, 'height', { configurable: true, value: 400 }); v.dispatchEvent(new Event('resize')); } });
      await pg.waitForFunction(() => document.querySelector('.g-app')?.getAttribute('data-keyboard') === 'true');
      assert(!(await pg.getByTestId('tabbar').isVisible()), 'tabbar covers the keyboard viewport');
      await pg.evaluate(() => { const v = visualViewport; if (v) { delete v.height; v.dispatchEvent(new Event('resize')); } });
      await pg.goto(t.URL + '#/settings/appearance', { waitUntil: 'networkidle' });
      await pg.getByTestId('add-mode').selectOption('note');
      await pg.getByTestId('tab-plan').click();
      await pg.getByTestId('tab-add').click();
      await pg.getByTestId('editor').getByRole('textbox').waitFor();
      assert(await pg.getByTestId('editor').getByRole('textbox').evaluate(el => document.activeElement === el), 'always-note mode did not focus note text');
    } finally { await ctx.close(); }
  });

  await check('W13 profile menu enters the explicitly focused profile', async () => {
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }], activeId: 'p1',
      stores: { p1: v5store([seedNote('one', 'One note', { content: '<p>one body</p>', text: 'one body' })], 'one'), p2: v5store([seedNote('two', 'Two note', { content: '<p>two body</p>', text: 'two body' })], 'two') },
    }));
    await page.getByTestId('profile-row-p1').getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('profile-picker').waitFor({ state: 'detached' });
    await page.getByTestId('note-list').waitFor();
    await page.getByTestId('profile-menu-open').click();
    await page.getByRole('menuitem', { name: 'Two', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('note-item').filter({ hasText: 'Two note' }).waitFor();
    const state = await page.evaluate(() => ({ registry: JSON.parse(localStorage.getItem('grafnot-profiles-v1')), p1: JSON.parse(localStorage.getItem('grafnot-store-p1')), p2: JSON.parse(localStorage.getItem('grafnot-store-p2')) }));
    assert(state.registry.activeId === 'p2', 'focused menu item entered another profile');
    assert(state.p1.notes[0].text === 'one body' && state.p2.notes[0].text === 'two body', 'switching through the menu changed note data');
  });
};
