// E2E group G33-identity (run order: e2e/check6.cjs).
// D1 (W2): the note on screen is the only target of note commands. Each check
// first makes the shown note differ from the last opened one (Back after a
// list click, a deep link over a reload, or a manual hash change) and then
// requires the command to change the shown note and nothing else.
// D2 (W3): deferred toast actions (Undo) act on the entity and profile they
// were armed for; a profile switch drops them visibly.
module.exports = async function (t) {
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
    await page.getByRole('button', { name: '+ Добавить вычисление' }).click();
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
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Beta' }).locator('.g-unlink').click();
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
      activeId: 'p1',
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
};
