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

  await check('W9 Back to a note brings its temporary panel back', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    await page.getByTestId('ctx-all-links').click();
    await page.getByTestId('ctx-panel').getByRole('button', { name: 'Beta', exact: true }).click();
    await page.waitForFunction(() => location.hash === '#/notes/b');
    assert(await page.getByTestId('ctx-panel').count() === 0, 'opening a linked note kept the temporary panel');
    await page.goBack();
    await page.waitForFunction(() => location.hash === '#/notes/a');
    await page.getByTestId('ctx-panel').waitFor();
  });

  await check('W9 Back brings the panel back without the Navigation API (Firefox, Safari)', async () => {
    const ctx = await t.browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: t.storageStateFor(seed()) });
    // Hide the Chromium-only API before the app loads: the fallback must carry the case.
    await ctx.addInitScript(() => { Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }); });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      assert(await pg.evaluate(() => window.navigation === undefined), 'Navigation API still visible');
      await pg.getByTestId('ctx-all-links').click();
      await pg.getByTestId('ctx-panel').getByRole('button', { name: 'Beta', exact: true }).click();
      await pg.waitForFunction(() => location.hash === '#/notes/b');
      assert(await pg.getByTestId('ctx-panel').count() === 0, 'opening a linked note kept the temporary panel');
      await pg.goBack();
      await pg.waitForFunction(() => location.hash === '#/notes/a');
      await pg.getByTestId('ctx-panel').waitFor({ timeout: 5000 }).catch(() => { throw new Error('Back did not bring the panel back'); });
      await pg.goForward();
      await pg.waitForFunction(() => location.hash === '#/notes/b');
      await pg.getByTestId('editor').waitFor();
      assert(await pg.getByTestId('ctx-panel').count() === 0, 'Forward to a note without a panel opened one');
    } finally {
      await ctx.close();
    }
  });

  await check('FG on a phone the note text starts in the upper half, links and tools in one row', async () => {
    const rich = seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
      stores: { p1: v5store([
        seedNote('a', 'Лекция по базам данных: нормализация', { content: '<p>alpha body</p>', text: 'alpha body', linkedIds: ['b', 'c', 'd'], updated: 4 }),
        seedNote('b', 'Функциональные зависимости', { linkedIds: ['a'], updated: 3 }),
        seedNote('c', 'Практика SQL JOIN', { updated: 2 }),
        seedNote('d', 'Очень длинное название заметки для проверки', { updated: 1 }),
      ], 'a', { graphs: [{ id: 'g1', title: 'БД', noteIds: ['a'] }], tasks: [{ id: 't1', text: 'Повторить', done: false, created: 1, noteId: 'a' }] }) },
    });
    const ctx = await t.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(rich) });
    try {
      const pg = await ctx.newPage();
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      const box = await pg.getByTestId('editor').getByRole('textbox').boundingBox();
      assert(box && box.y <= 422, 'note text starts at ' + (box && Math.round(box.y)) + ' px of 844');
      for (const id of ['ctx-all-links', 'ctx-open-tasks', 'ctx-open-prompts', 'ctx-show-map']) {
        assert(await pg.getByTestId(id).isVisible(), id + ' hidden on the phone');
      }
      const tops = await pg.getByTestId('ctx-block').evaluate((el) => [...el.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => Math.round(b.getBoundingClientRect().top)));
      assert(new Set(tops).size === 1, 'context tools wrap into rows: ' + tops.join(','));
      const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert(!overflow, 'the page scrolls sideways');
    } finally {
      await ctx.close();
    }
  });

  await check('W7 a phone sheet closes by pulling its grip down', async () => {
    const ctx = await t.browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(seed()) });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      await pg.getByTestId('ctx-all-links').click();
      const grip = await pg.getByTestId('sheet-grip').boundingBox();
      assert(grip && grip.height >= 20, 'sheet grip missing on the phone');
      const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
      await pg.mouse.move(x, y);
      await pg.mouse.down();
      await pg.mouse.move(x, y + 40, { steps: 4 });
      await pg.mouse.up();
      assert(await pg.getByTestId('ctx-panel').count() === 1, 'a short pull closed the sheet');
      await pg.mouse.move(x, y);
      await pg.mouse.down();
      await pg.mouse.move(x, y + 160, { steps: 8 });
      await pg.mouse.up();
      await pg.getByTestId('ctx-panel').waitFor({ state: 'detached' });
    } finally { await ctx.close(); }
  });

  await check('Palette keeps keys typed right after its first opening', async () => {
    await reseed(page, seed());
    await page.getByTestId('palette-open').click();
    await page.keyboard.type('Beta');
    await page.getByTestId('palette-input').waitFor();
    assert(await page.getByTestId('palette-input').inputValue() === 'Beta', 'first keys lost: ' + await page.getByTestId('palette-input').inputValue());
    await page.keyboard.press('Escape');
  });

  await check('FG a [[link]] stays in the text, opens with Ctrl+click and follows a rename', async () => {
    await reseed(page, seed());
    await body().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' see [[Bet');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'a').text.includes('see [[Beta]]'), null, { timeout: 8000 });
    await page.locator('[data-wikilink="Beta"]').first().click({ modifiers: ['Control'] });
    await page.waitForFunction(() => location.hash === '#/notes/b');
    // The hash changes before the editor shows Beta: rename only once it does.
    await page.waitForFunction(() => document.querySelector('[data-testid="title-in"]')?.value === 'Beta', null, { timeout: 8000 });
    await page.getByTestId('title-in').fill('Beta renamed');
    await page.getByTestId('title-in').press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'a').text.includes('[[Beta renamed]]'), null, { timeout: 8000 });
  });

  await check('FG a mouse click on a note in the list puts the caret in its text', async () => {
    await reseed(page, seed());
    await page.getByTestId('note-item').filter({ hasText: 'Beta' }).click();
    // The caret arrives with the note's render, a frame after the click.
    await page.waitForFunction(() => !!document.activeElement?.closest('[data-testid="editor"]'), null, { timeout: 8000 });
    await page.keyboard.type('Z');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === 'b').text.includes('Z'), null, { timeout: 8000 });
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.length) === 2, 'typing created a note');
  });

  await check('FG renaming a profile with Enter renames it and creates nothing', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/settings/profiles', { waitUntil: 'networkidle' });
    await page.getByTestId('settings-page').getByRole('button', { name: /Переименовать/ }).first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Жұмыс');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.some(p => p.name === 'Жұмыс'), null, { timeout: 8000 });
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.length) === 1, 'rename created a profile');
  });

  await check('FG renaming in the profile picker types into the name, saves on Enter, no bracket buttons', async () => {
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }], activeId: 'gone',
      stores: { p1: v5store([seedNote('one', 'One note', { content: '<p>one</p>', text: 'one' })], 'one'), p2: v5store([seedNote('two', 'Two note', { content: '<p>two</p>', text: 'two' })], 'two') },
    }));
    const picker = page.getByTestId('profile-picker');
    await picker.waitFor();
    assert(!/\[[^\]]+\]/.test(await picker.innerText()), 'bracketed buttons: ' + await picker.innerText());
    await picker.getByTestId('profile-row-p1').getByRole('button', { name: 'Переименовать' }).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Учёба');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.some(p => p.name === 'Учёба'), null, { timeout: 8000 })
      .catch(() => { throw new Error('picker rename did not reach the name field'); });
    assert(await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.length) === 2, 'rename created a profile');
    assert(await page.getByTestId('profile-name-in').inputValue() === '', 'typing landed in the new-profile field');
  });

  await check('FG menus stay on screen: note menu on a phone, «To note» at the bottom of a tablet', async () => {
    const inside = (b, w, h) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
    const phone = await t.browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(seed()) });
    try {
      const pg = await phone.newPage();
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      await pg.getByTestId('notes-more').click();
      const box = await pg.getByTestId('notes-menu-trash').locator('..').boundingBox();
      assert(inside(box, 375, 812), 'note menu leaves the phone screen: ' + JSON.stringify(box));
    } finally { await phone.close(); }
    const tab = await t.browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, storageState: t.storageStateFor(seed()) });
    try {
      const pg = await tab.newPage();
      await pg.goto(t.URL + '#/prompts/art', { waitUntil: 'networkidle' });
      const btn = pg.getByRole('button', { name: /В заметку/ });
      await btn.evaluate((el) => { el.scrollIntoView({ block: 'end' }); });
      await btn.click();
      const box = await pg.getByRole('listbox').boundingBox();
      assert(inside(box, 820, 1180), '«To note» list leaves the screen: ' + JSON.stringify(box));
    } finally { await tab.close(); }
  });

  await check('FG phone popups end above the tab bar: «To note» opened at the bottom is fully visible', async () => {
    const phone = await t.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(seed()) });
    try {
      const pg = await phone.newPage();
      await pg.goto(t.URL + '#/prompts/sql', { waitUntil: 'networkidle' });
      const btn = pg.getByRole('button', { name: /В заметку/ });
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      const list = pg.getByRole('listbox');
      await list.waitFor();
      const bar = await pg.getByTestId('tabbar').boundingBox();
      const box = await list.boundingBox();
      assert(bar && box && box.y >= 0 && box.y + box.height <= bar.y + 0.5, '«To note» list goes under the tab bar: ' + JSON.stringify({ box, bar }));
    } finally { await phone.close(); }
  });

  await check('FG the whole week fits 1366 px, phone days show their tasks, KZ names are Kazakh', async () => {
    const weekSeed = seed(), st = JSON.parse(weekSeed['grafnot-store-p1']);
    // storageState seeds skip the @today marker expansion: put today's date in directly.
    const now = new Date(), iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    st.tasks = [{ id: 'w1', text: 'Week task', done: false, due: iso }];
    weekSeed['grafnot-store-p1'] = JSON.stringify(st);
    const wide = await t.browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: t.storageStateFor(weekSeed) });
    try {
      const pg = await wide.newPage();
      await pg.goto(t.URL + '#/plan/week', { waitUntil: 'networkidle' });
      const grid = pg.locator('.w-grid');
      await grid.waitFor();
      const fits = await grid.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      assert(fits, 'the week scrolls sideways at 1366 px');
    } finally { await wide.close(); }
    const kz = { ...weekSeed, 'grafnot-lang:p1': 'KZ' };
    const phone = await t.browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, storageState: t.storageStateFor(kz) });
    try {
      const pg = await phone.newPage();
      await pg.goto(t.URL + '#/plan/week', { waitUntil: 'networkidle' });
      const strip = pg.getByRole('group', { name: 'Апта күндері' });
      await strip.waitFor();
      const text = await strip.innerText();
      assert(!/Mon|Tue|Wed|Thu|Fri/.test(text) && text.includes('Дс'), 'weekday names not Kazakh: ' + text.replace(/\s+/g, ' '));
      assert(await strip.getByTestId('day-count').count() === 1, 'days with tasks are not marked');
    } finally { await phone.close(); }
  });

  await check('FG settings speak plainly: named languages on every tab, no phone-only setting on desktop, dated backup', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/settings/profiles', { waitUntil: 'networkidle' });
    await page.getByTestId('settings-page').getByRole('button', { name: 'English', exact: true }).click();
    await page.getByTestId('settings-nav-data').waitFor();
    assert((await page.getByTestId('settings-nav-data').innerText()).trim() === 'Data', 'language did not switch from the first tab');
    assert(!(await page.getByTestId('settings-page').innerText()).includes('['), 'bracketed link-buttons remain');
    await page.getByTestId('settings-page').getByRole('button', { name: 'Русский', exact: true }).click();
    await page.goto(t.URL + '#/settings/appearance', { waitUntil: 'networkidle' });
    assert(!(await page.getByTestId('add-mode').isVisible()), 'the phone «+» setting shows on desktop');
    await page.goto(t.URL + '#/settings/data', { waitUntil: 'networkidle' });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-current').click()]);
    assert(/^grafnot-.+-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && !dl.suggestedFilename().includes('unsaved'), 'backup file name: ' + dl.suggestedFilename());
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

  const twoProfiles = (activeId) => seedProfiles({
    profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }], activeId,
    stores: { p1: v5store([seedNote('one', 'One note', { content: '<p>one body</p>', text: 'one body' })], 'one'), p2: v5store([seedNote('two', 'Two note', { content: '<p>two body</p>', text: 'two body' })], 'two') },
  });

  await check('W13 a healthy registry reopens the last profile; a missing one asks', async () => {
    await reseed(page, twoProfiles('p2'));
    await page.getByTestId('note-item').filter({ hasText: 'Two note' }).waitFor();
    assert(await page.getByTestId('profile-picker').count() === 0, 'picker shown for a known last profile');
    await reseed(page, twoProfiles('gone'));
    await page.getByTestId('profile-picker').waitFor();
    const reg = await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')));
    assert(reg.profiles.length === 2, 'a missing last profile created or dropped profiles');
  });

  await check('W14 a file restores into a new profile; a damaged file changes nothing', async () => {
    await reseed(page, seed());
    const before = await page.evaluate(() => localStorage.getItem('grafnot-store-p1'));
    await page.goto(t.URL + '#/settings/data', { waitUntil: 'networkidle' });
    const file = JSON.stringify(v5store([seedNote('x', 'Imported', { content: '<p>imported body</p>', text: 'imported body', linkedIds: ['ghost'] })], 'x'));
    await page.getByTestId('import-file').setInputFiles({ name: 'Курс.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await page.getByTestId('note-item').filter({ hasText: 'Imported' }).waitFor();
    const s = await page.evaluate(() => {
      const reg = JSON.parse(localStorage.getItem('grafnot-profiles-v1'));
      return { reg, p1: localStorage.getItem('grafnot-store-p1'), copy: JSON.parse(localStorage.getItem('grafnot-store-' + reg.activeId)) };
    });
    assert(s.reg.profiles.length === 2 && s.reg.activeId !== 'p1', 'restore did not open a new profile');
    assert(s.reg.profiles.some(p => p.name === 'Курс'), 'new profile not named after the file');
    assert(s.p1 === before, 'restore touched the current profile');
    assert(s.copy.notes[0].text === 'imported body' && s.copy.notes[0].linkedIds.length === 0, 'restored copy differs or kept a dangling link');
    await page.goto(t.URL + '#/settings/data', { waitUntil: 'networkidle' });
    const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('grafnot-store-')).sort().join());
    await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ notes: [{ id: 'a', title: 'A', linkedIds: [3] }], tasks: [] })) });
    await page.getByTestId('import-error').waitFor();
    const after = await page.evaluate(() => ({ n: JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.length, keys: Object.keys(localStorage).filter(k => k.startsWith('grafnot-store-')).sort().join() }));
    assert(after.n === 2 && after.keys === keys, 'a damaged file changed profiles or stores');
  });

  await check('W14 current-version export carries what is on screen', async () => {
    await reseed(page, seed());
    await body().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' fresh edit');
    await page.goto(t.URL + '#/settings/data', { waitUntil: 'networkidle' });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-current').click()]);
    const text = require('fs').readFileSync(await dl.path(), 'utf8');
    const data = JSON.parse(text);
    assert(data.notes.find(n => n.id === 'a').text.endsWith('fresh edit'), 'current version export misses the edit');
  });

  await check('W13 profile menu enters the explicitly focused profile', async () => {
    await reseed(page, twoProfiles('p1'));
    await page.getByTestId('note-list').waitFor();
    await page.getByTestId('profile-menu-open').click();
    await page.getByRole('menuitemradio', { name: 'Two', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('note-item').filter({ hasText: 'Two note' }).waitFor();
    const state = await page.evaluate(() => ({ registry: JSON.parse(localStorage.getItem('grafnot-profiles-v1')), p1: JSON.parse(localStorage.getItem('grafnot-store-p1')), p2: JSON.parse(localStorage.getItem('grafnot-store-p2')) }));
    assert(state.registry.activeId === 'p2', 'focused menu item entered another profile');
    assert(state.p1.notes[0].text === 'one body' && state.p2.notes[0].text === 'two body', 'switching through the menu changed note data');
  });
};
