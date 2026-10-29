// E2E group G33-identity (run order: e2e/check6.cjs).
// D1 (W2): the note on screen is the only target of note commands. Each check
// first makes the shown note differ from the last opened one (Back after a
// list click, a deep link over a reload, or a manual hash change) and then
// requires the command to change the shown note and nothing else.
// D2 (W3): deferred toast actions (Undo) act on the entity and profile they
// were armed for; a profile switch drops them visibly.
module.exports = async function (t) {
  const { openContext, closeContext, insertCalculation } = t;
  const { seedProfiles, v5store, seedNote, beginGroup, groupActive, reseed, check, assert, page } = t;

  const seed = () => seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store([
        seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body', updated: 3 }),
        seedNote('b', 'Beta', { content: '<p>beta body</p>', text: 'beta body', updated: 2 }),
        seedNote('c', 'Gamma', { content: '<p>gamma body</p>', text: 'gamma body', updated: 1 }),
      ], 'a'),
    },
  });

  await beginGroup('G33-identity', seed());
  if (!(await groupActive('G33-identity'))) return;

  const storeOf = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1') || 'null'));
  const noteOf = (s, id) => s.notes.find((n) => n.id === id);
  // Debounced autosave: wait for the stored state instead of sleeping.
  async function waitStore(pred, msg) {
    try {
      await page.waitForFunction(pred, null, { timeout: 8000 });
    } catch {
      throw new Error(msg);
    }
  }
  const titleIs = (v) => page.waitForFunction((x) => (document.querySelector('[data-testid="title-in"]') || {}).value === x, v, { timeout: 8000 });
  const hashIs = (h) => page.waitForFunction((x) => window.location.hash === x, h, { timeout: 8000 });

  // Fresh seed, land on Alpha, open Gamma from the list, go Back: Alpha is
  // shown while Gamma was the last note opened through the list.
  async function backToAlpha() {
    await reseed(page, seed());
    await hashIs('#/notes/a');
    await page.getByTestId('note-item').filter({ hasText: 'Gamma' }).first().click();
    await hashIs('#/notes/c');
    await titleIs('Gamma');
    await page.goBack();
    await hashIs('#/notes/a');
    await titleIs('Alpha');
  }
  // Fresh seed (last opened: Alpha), then load the app on #/notes/<id>.
  async function deepLink(id, title) {
    await reseed(page, seed());
    await page.evaluate((x) => { window.location.hash = '#/notes/' + x; }, id);
    await page.reload({ waitUntil: 'networkidle' });
    await titleIs(title);
  }

  await check('D1 typing after Back edits the shown note', async () => {
    await backToAlpha();
    await page.locator('.tiptap').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' MARKA');
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a') || {}).text.includes('MARKA'), 'typed text did not reach Alpha');
    const s = await storeOf();
    assert(noteOf(s, 'c').text === 'gamma body', 'Gamma changed: ' + noteOf(s, 'c').text);
  });

  await check('D1 deep link delete trashes the shown note', async () => {
    await deepLink('c', 'Gamma');
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await waitStore(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1')).trash.some((n) => n.id === 'c'), 'Gamma not in trash');
    const s = await storeOf();
    assert(noteOf(s, 'a') && noteOf(s, 'b'), 'another note was deleted: ' + s.notes.map((n) => n.id).join(','));
  });

  await check('D1 duplicate after manual hash copies the shown note', async () => {
    await reseed(page, seed());
    await hashIs('#/notes/a');
    await page.evaluate(() => { window.location.hash = '#/notes/b'; });
    await titleIs('Beta');
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-duplicate').click();
    await waitStore(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.length === 4, 'no copy saved');
    const s = await storeOf();
    const copy = s.notes.find((n) => !['a', 'b', 'c'].includes(n.id));
    assert(copy.title.startsWith('Beta') && copy.text === 'beta body', 'copied the wrong note: ' + copy.title);
  });

  await check('D1 export after Back downloads the shown note', async () => {
    await backToAlpha();
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      (async () => {
        await page.getByTestId('notes-more').click();
        await page.getByTestId('notes-menu-export').click();
      })(),
    ]);
    const name = await dl.suggestedFilename();
    assert(name === 'Alpha.md', 'exported ' + name);
  });

  await check('D1 rename after deep link renames the shown note', async () => {
    await deepLink('c', 'Gamma');
    await page.getByTestId('title-in').fill('Gamma renamed');
    await page.getByTestId('title-in').press('Enter');
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'c') || {}).title === 'Gamma renamed', 'Gamma not renamed');
    const s = await storeOf();
    assert(noteOf(s, 'a').title === 'Alpha', 'Alpha renamed to ' + noteOf(s, 'a').title);
  });

  await check('D1 calc after Back lands in the shown note', async () => {
    await backToAlpha();
    await insertCalculation(page);
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a') || {}).calcs.length === 1, 'calc not in Alpha');
    const s = await storeOf();
    assert(noteOf(s, 'c').calcs.length === 0, 'calc added to Gamma');
  });

  await check('D1 link after Back lands in the shown note', async () => {
    await backToAlpha();
    await page.locator('.tiptap').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' [[Beta');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a') || {}).linkedIds.includes('b'), 'link not in Alpha');
    const s = await storeOf();
    assert(noteOf(s, 'c').linkedIds.length === 0, 'link added to Gamma');
  });

  await check('D2 unlink Undo after opening another note restores the original note', async () => {
    const linked = seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: {
        p1: v5store([
          seedNote('a', 'Alpha', { linkedIds: ['b'], updated: 3 }),
          seedNote('b', 'Beta', { updated: 2 }),
          seedNote('c', 'Gamma', { updated: 1 }),
        ], 'a'),
      },
    });
    await reseed(page, linked);
    await hashIs('#/notes/a');
    await openContext(page);
    await page.getByTestId('ctx-panel').getByRole('tabpanel').locator('li', { hasText: 'Beta' }).getByRole('button', { name: 'Убрать связь', exact: true }).click();
    await closeContext(page);
    await page.locator('.g-toast-undo').waitFor();
    await page.getByTestId('note-item').filter({ hasText: 'Gamma' }).first().click();
    await titleIs('Gamma');
    await page.locator('.g-toast-undo').first().click();
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a') || {}).linkedIds.includes('b'), 'link not restored into Alpha');
    const s = await storeOf();
    assert(noteOf(s, 'c').linkedIds.length === 0, 'Undo added the link to Gamma');
  });

  await check('D2 graph delete Undo never reaches the next profile', async () => {
    const two = seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }, { id: 'p2', name: 'Второй', created: 2 }],
      activeId: '', // W13: no known last profile, startup asks
      stores: {
        p1: v5store([seedNote('a', 'Alpha')], 'a', { graphs: [{ id: 'g1', title: 'Курс', noteIds: ['a'] }] }),
        p2: v5store([seedNote('m', 'Mu')], 'm'),
      },
    });
    await reseed(page, two);
    await page.getByTestId('profile-picker').waitFor();
    await page.getByTestId('profile-row-p1').locator('button').first().click();
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Курс/ }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    // Switch profiles while the Undo toast is still alive.
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.getByTestId('profile-picker').waitFor();
    const told = await page.locator('.g-toasts', { hasText: 'Отмена недоступна' }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    await page.getByTestId('profile-row-p2').locator('button').first().click();
    await page.getByTestId('nav-notes').waitFor();
    // A stale Undo must be gone; if one is still offered, using it must not write here.
    const stale = page.locator('.g-toast-undo');
    if (await stale.count()) await stale.first().click();
    await page.waitForTimeout(1200);
    const p2 = await page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-store-p2') || 'null'));
    assert(p2 && p2.graphs.length === 0, 'graph from p1 leaked into p2: ' + JSON.stringify(p2 && p2.graphs));
    assert(told, 'no "Undo unavailable" message after the profile switch');
  });

  await check('D1 reload without a hash lands on the last shown note', async () => {
    await backToAlpha();
    // Let every debounced save land (400 ms debounce): reading earlier would
    // see the seed's activeId and pass before the list click is persisted.
    await page.waitForTimeout(1500);
    const s = await storeOf();
    assert(s.activeId === 'a', 'last shown note not remembered: activeId=' + s.activeId);
    await page.evaluate(() => { window.location.hash = ''; });
    await page.reload({ waitUntil: 'networkidle' });
    await titleIs('Alpha');
  });

  // W6: creation and input are pinned to the new note, presentation is derived.
  const body = (pg = page) => pg.getByTestId('editor').getByRole('textbox');
  async function createBlank(pg = page) {
    const before = new URL(pg.url()).hash;
    await pg.keyboard.press('Control+k');
    await pg.getByTestId('palette-item-0').click();
    await pg.waitForFunction(prev => location.hash !== prev && location.hash.startsWith('#/notes/'), before);
    await pg.getByTestId('title-in').waitFor();
    return new URL(pg.url()).hash.slice('#/notes/'.length);
  }
  async function focusedBody(pg = page) {
    assert(await pg.evaluate(() => !!document.activeElement?.closest('[data-testid="editor"]')), 'new note body did not receive focus');
    assert((await pg.getByTestId('title-in').inputValue()) === '', 'new note has a stored automatic title');
  }

  await check('W6 first RU KZ input, paste and reload stay in the unnamed note', async () => {
    for (const [lang, text] of [['RU', 'Первая мысль'], ['KZ', 'Ә Ғ Қ Ң Ө Ұ Ү Һ І']]) {
      await reseed(page, { ...seed(), ['grafnot-lang:p1']: lang });
      await page.getByTestId('title-in').waitFor();
      await page.evaluate(() => {
        window.__w6Frame = null;
        window.addEventListener('hashchange', () => requestAnimationFrame(() => {
          window.__w6Frame = !!document.activeElement?.closest('[data-testid="editor"]');
        }), { once: true });
      });
      const id = await createBlank(page);
      await focusedBody();
      await page.waitForFunction(() => window.__w6Frame !== null);
      assert(await page.evaluate(() => window.__w6Frame), 'new body was not focused in the first route frame');
      await page.keyboard.insertText(text);
      await body().evaluate(el => {
        const data = new DataTransfer();
        data.setData('text/plain', ' paste');
        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      });
      await page.waitForFunction(x => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.some(n => n.id === x && n.title === '' && n.text.includes(' paste')), id);
      await page.reload({ waitUntil: 'networkidle' });
      assert((await page.getByTestId('title-in').inputValue()) === '', 'reload materialized a display name');
      assert((await body().innerText()).includes(text), 'first input lost on reload');
      await body().focus();
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('Shift+Tab');
      assert(await page.getByTestId('title-in').evaluate(el => document.activeElement === el), 'Shift+Tab from start did not reach title');
      assert((await page.title()).includes(text), 'browser title does not use computed name');
      assert((await storeOf()).notes.find(n => n.id === 'a').title === 'Alpha', 'legacy title changed');
    }
  });

  await check('W6 first-key IME, composing Enter Escape and dead key preserve text', async () => {
    await reseed(page, seed());
    const id = await createBlank();
    await focusedBody();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.imeSetComposition', { text: 'қазақ', selectionStart: 5, selectionEnd: 5 });
      await cdp.send('Input.insertText', { text: 'қазақ' });
      await page.waitForFunction(() => document.querySelector('[data-testid="editor"]')?.textContent.includes('қазақ'));
      await page.keyboard.press('Enter');
      await page.keyboard.insertText('/');
      await page.getByTestId('slash-menu').waitFor();
      const stableHash = new URL(page.url()).hash;
      await body().evaluate(el => {
        for (const key of ['Enter', 'Escape']) el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, isComposing: true, keyCode: 229, bubbles: true, cancelable: true }));
      });
      assert((await page.getByTestId('slash-menu').count()) === 1, 'composing keys ran a menu command or closed the menu');
      assert(new URL(page.url()).hash === stableHash, 'composition changed route');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');
      await cdp.send('Input.imeSetComposition', { text: 'cancel', selectionStart: 6, selectionEnd: 6 });
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Dead', code: 'Quote' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Dead', code: 'Quote' });
      await cdp.send('Input.insertText', { text: 'é' });
      await page.waitForFunction(x => {
        const n = JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === x);
        return n?.text.includes('қазақ') && n.text.includes('é') && !n.text.includes('cancel');
      }, id);
      assert((await storeOf()).notes.length === 4, 'IME created another note');
    } finally {
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }).catch(() => {});
      await cdp.detach();
    }
  });

  await check('W6 two rapid creations keep each first input by id', async () => {
    await reseed(page, seed());
    const first = await createBlank();
    await focusedBody();
    await page.keyboard.insertText('FIRST');
    const second = await createBlank();
    await focusedBody();
    await page.keyboard.insertText('SECOND');
    assert(first !== second, 'creation reused an id');
    await page.waitForFunction(([a, b]) => {
      const ns = JSON.parse(localStorage.getItem('grafnot-store-p1')).notes;
      return ns.find(n => n.id === a)?.text === 'FIRST' && ns.find(n => n.id === b)?.text === 'SECOND';
    }, [first, second]);
    const ns = (await storeOf()).notes.filter(n => [first, second].includes(n.id));
    assert(ns.every(n => n.title === ''), 'computed names written into titles');
    await page.getByTestId('title-in').fill('Named');
    await page.getByTestId('title-in').press('Enter');
    await page.getByTestId('title-in').fill('');
    await page.getByTestId('title-in').press('Enter');
    await page.waitForFunction(x => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find(n => n.id === x)?.title === '', second);
    await page.goBack();
    await page.getByTestId('title-in').waitFor();
    assert((await body().innerText()).includes('FIRST'), 'Back loaded a different document');
  });

  await check('W6 leaving before a lazy editor mounts cancels its focus request', async () => {
    const ctx = await t.browser.newContext({ storageState: t.storageStateFor(seed()) });
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const pg = await ctx.newPage();
    await pg.route('**/NotesView-*.js', async route => { await ready; await route.continue(); });
    try {
      await pg.goto(t.URL + '#/plan/list', { waitUntil: 'domcontentloaded' });
      await pg.getByTestId('task-search').waitFor();
      await pg.keyboard.press('Control+k');
      await pg.getByTestId('palette-item-0').click();
      await pg.waitForFunction(() => location.hash.startsWith('#/notes/'));
      await pg.goBack();
      await pg.getByTestId('task-search').focus();
      release();
      await pg.waitForLoadState('networkidle');
      assert(await pg.getByTestId('task-search').evaluate(el => document.activeElement === el), 'late editor stole focus after Back');
      await pg.keyboard.insertText('PLAN ONLY');
      assert((await pg.getByTestId('task-search').inputValue()) === 'PLAN ONLY', 'input escaped the task field');
      const s = await pg.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
      assert(s.notes.filter(n => !['a', 'b', 'c'].includes(n.id)).every(n => n.text === ''), 'late editor received task text');
    } finally { release(); await ctx.close(); }
  });

  await check('W6 immediate profile switch never reuses the old creation focus', async () => {
    const s = seedProfiles({
      profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }],
      activeId: '', stores: { p1: v5store([seedNote('a', 'Alpha')], 'a'), p2: v5store([seedNote('p2n', 'Other')], 'p2n') }, // W13: startup asks
    });
    await reseed(page, s);
    await page.getByTestId('profile-row-p1').getByRole('button').first().click();
    // Navigation exists on the picker too; wait for the async registry entry.
    await page.getByTestId('profile-picker').waitFor({ state: 'detached' });
    await page.getByTestId('note-list').waitFor();
    const id = await createBlank();
    await focusedBody();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.getByTestId('profile-row-p2').getByRole('button').first().click();
    await page.getByTestId('profile-picker').waitFor({ state: 'detached' });
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('note-item').first().click();
    await body().click();
    await page.keyboard.insertText('PROFILE TWO');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p2')).notes[0].text.includes('PROFILE TWO'));
    const p1 = await storeOf();
    assert(p1.notes.find(n => n.id === id)?.text === '', 'input leaked into the previous profile');
  });

  await check('W6 computed names cover search links map tasks trash and export', async () => {
    const title = 'Строка для имени';
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
      stores: { p1: v5store([
        seedNote('u', '', { content: '<p>Строка для имени</p><p>Second line</p>', text: title + '\n\nSecond line', updated: Date.UTC(2026, 9, 29) }),
        seedNote('a', 'Новая заметка 2', { linkedIds: ['u'], updated: 1 }),
      ], 'u', { graphs: [{ id: 'g1', title: 'Names', noteIds: ['u', 'a'] }], tasks: [{ id: 'task-u', text: 'Linked task', done: false, noteId: 'u' }] }) },
    }));
    await page.getByTestId('title-in').waitFor();
    assert((await page.getByTestId('title-in').inputValue()) === '', 'display name stored as title');
    const unnamed = page.getByTestId('note-item').filter({ hasText: title });
    assert((await unnamed.count()) === 1, 'derived name missing in notes list');
    assert((await unnamed.getAttribute('aria-label')).startsWith('Без названия: ' + title), 'derived accessible name missing');
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('Second line');
    assert((await page.getByTestId('palette-item-0').innerText()).includes(title), 'derived palette name missing');
    await page.keyboard.press('Escape');
    const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
      await page.getByTestId('notes-more').click();
      await page.getByTestId('notes-menu-export').click();
    })()]);
    assert(download.suggestedFilename() === title + '.md', 'derived export filename missing');
    await page.getByTestId('note-item').filter({ hasText: 'Новая заметка 2' }).click();
    await openContext(page);
    assert((await page.getByRole('button', { name: 'Без названия: ' + title, exact: true }).count()) >= 1, 'derived link label missing');
    await closeContext(page);
    await body().click();
    await page.keyboard.insertText('[[' + title);
    await page.getByTestId('link-suggest-item-0').waitFor();
    assert((await page.getByTestId('link-suggest-item-0').innerText()).includes(title), 'derived [[ suggestion missing');
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-plan').click();
    assert((await page.getByTestId('task-row').first().innerText()).includes(title), 'task source looks deleted');
    await page.getByTestId('nav-map').click();
    await page.getByRole('button', { name: 'Без названия: ' + title, exact: true }).click();
    assert((await page.getByTestId('map-peek').innerText()).includes(title), 'derived map name missing');
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('note-item').filter({ hasText: title }).click();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    assert((await page.getByRole('status').allTextContents()).join(' ').includes(title), 'derived delete toast name missing');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-trash').click();
    // The settings container survives hash navigation; wait for the trash content.
    await page.getByTestId('settings-page').getByText(title, { exact: true }).waitFor();
    assert((await page.getByTestId('settings-page').innerText()).includes(title), 'derived trash name missing');
    assert((await storeOf()).trash.find(n => n.id === 'u').title === '', 'trash materialized a display name');
  });

  await check('W6 cold creation from Plan focuses text in the first route frame', async () => {
    const ctx = await t.browser.newContext({ storageState: t.storageStateFor(seed()) });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/plan/list', { waitUntil: 'networkidle' });
      await pg.evaluate(() => {
        window.firstCreationFrame = null;
        window.addEventListener('hashchange', () => requestAnimationFrame(() => {
          window.firstCreationFrame = !!document.activeElement?.closest('[data-testid="editor"]');
        }), { once: true });
      });
      await createBlank(pg);
      await focusedBody(pg);
      await pg.waitForFunction(() => window.firstCreationFrame !== null);
      assert(await pg.evaluate(() => window.firstCreationFrame), 'cold creation missed the first route frame');
    } finally { await ctx.close(); }
  });
};
