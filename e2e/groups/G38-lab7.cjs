// E2E group G38-lab7 (run order: e2e/check6.cjs).
// Heuristic evaluation fixes (Lab 7 report, HE-1/HE-7 and P3-P6) and
// the profile form validation: palette recovery and recent notes, due date read
// from the task title, the context panel's own link picker, one row per mutual
// link, no desktop Back while the list is visible, profile name errors/success.
module.exports = async function (t) {
  const { page, check, assert, seedProfiles, seedNote, v5store, beginGroup, groupActive, reseed } = t;
  const seed = () => seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }, { id: 'p2', name: 'Работа', created: 2 }], activeId: 'p1',
    stores: {
      p1: v5store([
        seedNote('a', 'Normalization', { content: '<p>alpha body</p>', text: 'alpha body', linkedIds: ['b'], updated: 30 }),
        seedNote('b', 'Transactions', { content: '<p>beta body</p>', text: 'beta body', linkedIds: ['a'], updated: 20 }),
        seedNote('c', 'Gamma notes', { updated: 10 }),
        seedNote('d', 'Delta', { updated: 5 }),
      ], 'a'),
      p2: v5store([], ''),
    },
  });
  await beginGroup('G38-lab7', seed());
  if (!await groupActive('G38-lab7')) return;
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
  const registry = () => page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')));
  const waitStored = (fn, why) => page.waitForFunction((src) => {
    // eslint-disable-next-line no-new-func
    return new Function('s', 'return (' + src + ')(s)')(JSON.parse(localStorage.getItem('grafnot-store-p1')));
  }, fn.toString(), { timeout: 8000 }).catch(() => { throw new Error(why); });
  const tomorrow = () => page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const openPalette = async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').waitFor();
  };

  await check('HE-1 a typo in Ctrl+K explains the miss and Enter opens the close note', async () => {
    await reseed(page, seed());
    await openPalette();
    await page.getByTestId('palette-input').fill('nrom');
    await page.getByTestId('palette-miss').waitFor();
    assert((await page.getByTestId('palette-miss-hint').count()) === 1, 'no search-scope hint');
    assert((await page.getByTestId('palette-item-0').innerText()).includes('Normalization'), 'close note not suggested first');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/notes/a', null, { timeout: 8000 }).catch(() => { throw new Error('Enter did not open the suggestion'); });
  });

  await check('HE-1 the create row makes a note titled by the query', async () => {
    await reseed(page, seed());
    await openPalette();
    await page.getByTestId('palette-input').fill('Qwerty plan');
    await page.getByTestId('palette-miss').waitFor();
    assert((await page.locator('[data-testid^="palette-item-"]').count()) === 1, 'unrelated notes suggested');
    await page.keyboard.press('Enter');
    await waitStored((s) => s.notes.some((n) => n.title === 'Qwerty plan'), 'create row did not create the titled note');
  });

  await check('P4 an empty palette lists commands first, then the three most recent notes', async () => {
    await reseed(page, seed());
    await openPalette();
    const rows = page.locator('[data-testid^="palette-item-"]');
    await rows.first().waitFor();
    const texts = await rows.allInnerTexts();
    const recent = texts.slice(-3).join(' | ');
    assert(recent.includes('Normalization') && recent.includes('Transactions') && recent.includes('Gamma notes') && !recent.includes('Delta'), 'recent notes wrong: ' + recent);
    // Quick Add stays first: item 0 is still a command (creating a note on Enter).
    assert(!texts[0].includes('Normalization'), 'a note displaced the first command');
  });

  await check('HE-7 a day word in the task title sets the due date and the toast names it', async () => {
    await reseed(page, seed());
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer-title').click();
    await page.getByTestId('task-composer-title').fill('Повторить транзакции завтра');
    await page.getByTestId('task-due-detected').waitFor();
    assert((await page.getByTestId('task-due-tomorrow').getAttribute('aria-pressed')) === 'true', 'tomorrow chip not selected');
    await page.keyboard.press('Enter');
    const due = await tomorrow();
    await waitStored(new Function('s', `return s.tasks.some((x) => x.text === 'Повторить транзакции завтра' && x.due === '${due}')`), 'task not saved with tomorrow');
    const dm = due.slice(8, 10) + '.' + due.slice(5, 7);
    await page.locator('.g-toast', { hasText: dm }).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error('toast does not name the date ' + dm); });
  });

  await check('HE-7 a chip picked by hand overrides the word', async () => {
    await reseed(page, seed());
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer-title').click();
    await page.getByTestId('task-composer-title').fill('Сдать отчёт сегодня');
    await page.getByTestId('task-due-detected').waitFor();
    await page.getByTestId('task-due-none').click();
    assert((await page.getByTestId('task-due-detected').count()) === 0, 'detection still shown after a manual choice');
    await page.getByTestId('task-composer-title').press('Enter');
    await waitStored((s) => s.tasks.some((x) => x.text === 'Сдать отчёт сегодня' && !x.due), 'manual «No date» lost');
  });

  await check('Profile form: empty and taken names show an error and create nothing', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/settings/profiles', { waitUntil: 'networkidle' });
    const input = page.getByTestId('profile-name-in');
    await input.click();
    await input.press('Enter');
    await page.getByTestId('profile-name-in-error').waitFor();
    assert((await input.getAttribute('aria-invalid')) === 'true', 'field not marked invalid');
    await input.fill('  работа ');
    await input.press('Enter');
    assert((await page.getByTestId('profile-name-in-error').innerText()).includes('работа'), 'taken name not explained');
    assert((await registry()).profiles.length === 2, 'an invalid name created a profile');
  });

  await check('Profile form: a valid name creates the profile and says so', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/settings/profiles', { waitUntil: 'networkidle' });
    await page.getByTestId('profile-name-in').fill('Учёба');
    await page.getByTestId('profile-name-in').press('Enter');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.some((p) => p.name === 'Учёба'), null, { timeout: 8000 });
    await page.locator('.g-toast', { hasText: 'Учёба' }).first().waitFor({ timeout: 5000 }).catch(() => { throw new Error('no success toast'); });
  });

  await check('Profile rename in the picker refuses a taken name', async () => {
    await reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }], activeId: 'gone',
      stores: { p1: v5store([seedNote('one', 'One note')], 'one'), p2: v5store([seedNote('two', 'Two note')], 'two') },
    }));
    const picker = page.getByTestId('profile-picker');
    await picker.waitFor();
    await picker.getByTestId('profile-row-p1').getByRole('button', { name: 'Переименовать' }).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('two');
    await page.keyboard.press('Enter');
    await picker.getByRole('alert').waitFor();
    const names = (await registry()).profiles.map((p) => p.name).join(',');
    assert(names === 'One,Two', 'taken rename changed the registry: ' + names);
  });

  await check('P3 «+ Link» in the context panel links by id and leaves the text alone', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    await page.getByTestId('ctx-all-links').click();
    await page.getByTestId('ctx-link-add').click();
    await page.getByTestId('ctx-link-q').fill('Gam');
    await page.getByTestId('ctx-link-q').press('Enter');
    await page.getByTestId('ctx-link-done').waitFor();
    await waitStored((s) => s.notes.find((n) => n.id === 'a').linkedIds.includes('c'), 'link not stored');
    const a = (await stored()).notes.find((n) => n.id === 'a');
    assert(!JSON.stringify(a.content).includes('[[') && a.text === 'alpha body', 'the text was edited: ' + a.text);
  });

  await check('P5/P6 a mutual link is one row; no desktop Back while the list is visible', async () => {
    await reseed(page, seed());
    await page.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
    await page.getByTestId('note-list').waitFor();
    assert((await page.getByTestId('notes-back').count()) === 0, 'desktop Back shown next to the list');
    await page.getByTestId('ctx-all-links').click();
    const panel = page.getByTestId('ctx-panel').getByRole('tabpanel');
    await panel.waitFor();
    assert((await panel.locator('li', { hasText: /^.*Transactions/ }).count()) === 1, 'mutual link listed twice');
    await page.getByTestId('ctx-links-legend').waitFor();
  });
};
