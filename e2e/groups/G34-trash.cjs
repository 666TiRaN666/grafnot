// E2E group G34-trash (run order: e2e/check6.cjs).
// D3 (W4): deleting a note and bringing it back restores what pointed at it —
// links from other notes and graph membership — through Undo, through the
// trash after a reload, and without rolling back edits made in between.
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, groupActive, reseed, check, assert, page } = t;

  // Alpha -> Beta, Gamma -> Beta; Alpha and Beta in graph «Курс».
  const seed = () => seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: {
      p1: v5store([
        seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body', linkedIds: ['b'], updated: 3 }),
        seedNote('b', 'Beta', { content: '<p>beta body</p>', text: 'beta body', updated: 2 }),
        seedNote('c', 'Gamma', { content: '<p>gamma body</p>', text: 'gamma body', linkedIds: ['b'], updated: 1 }),
      ], 'a', { graphs: [{ id: 'g1', title: 'Курс', noteIds: ['a', 'b'] }] }),
    },
  });

  await beginGroup('G34-trash', seed());
  if (!(await groupActive('G34-trash'))) return;

  const storeOf = () => page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1') || 'null'));
  async function waitStore(pred, msg) {
    try {
      await page.waitForFunction(pred, null, { timeout: 8000 });
    } catch {
      throw new Error(msg);
    }
  }
  const titleIs = (v) => page.waitForFunction((x) => (document.querySelector('[data-testid="title-in"]') || {}).value === x, v, { timeout: 8000 });
  // Everything that pointed at Beta before the deletion points at it again.
  function assertRestored(s, where) {
    const n = (id) => s.notes.find((x) => x.id === id);
    assert(n('b'), where + ': Beta not back in notes');
    assert(!s.trash.some((x) => x.id === 'b'), where + ': Beta still in trash');
    assert(n('a').linkedIds.includes('b'), where + ': Alpha -> Beta link lost');
    assert(n('c').linkedIds.includes('b'), where + ': Gamma -> Beta link lost');
    const g = s.graphs.find((x) => x.id === 'g1');
    assert(g && g.noteIds.includes('b'), where + ': Beta left graph «Курс»');
  }
  async function deleteBeta() {
    await page.evaluate(() => { window.location.hash = '#/notes/b'; });
    await titleIs('Beta');
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await waitStore(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1')).trash.some((n) => n.id === 'b'), 'Beta not in trash');
  }
  async function restoreBetaFromTrash() {
    // The old settings link still lands on the trash section.
    await page.evaluate(() => { window.location.hash = '#/settings/trash'; });
    const row = page.getByTestId('trash-page').locator('.g-sugg', { hasText: 'Beta' });
    await row.getByRole('button', { name: /восстановить/ }).click();
    await waitStore(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.some((n) => n.id === 'b'), 'Beta not restored');
  }

  await check('D3 delete Undo restores incoming links and graph membership', async () => {
    await reseed(page, seed());
    await deleteBeta();
    await page.locator('.g-toast-undo').first().click();
    await waitStore(() => JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.some((n) => n.id === 'b'), 'Undo did not bring Beta back');
    await page.waitForTimeout(600);
    assertRestored(await storeOf(), 'Undo');
  });

  await check('D3 delete, reload, restore from trash brings links and membership back', async () => {
    await reseed(page, seed());
    await deleteBeta();
    await page.waitForTimeout(600);
    await page.reload({ waitUntil: 'networkidle' });
    await restoreBetaFromTrash();
    await page.waitForTimeout(600);
    assertRestored(await storeOf(), 'reload + trash');
  });

  await check('Trash is its own section: rail entry with count, phone menu entry, not in settings', async () => {
    await reseed(page, seed());
    await deleteBeta();
    const entry = page.getByTestId('nav-trash');
    assert((await entry.innerText()).includes('1'), 'trash entry shows no count');
    await entry.click();
    await page.waitForFunction(() => location.hash === '#/trash');
    await page.getByTestId('trash-page').locator('.g-sugg', { hasText: 'Beta' }).waitFor();
    await page.goto(t.URL + '#/settings/profiles', { waitUntil: 'networkidle' });
    assert(await page.getByTestId('settings-nav-trash').count() === 0, 'settings still has a trash tab');
    const ctx = await t.browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
    const pg = await ctx.newPage();
    try {
      await pg.goto(t.URL + '#/notes/a', { waitUntil: 'networkidle' });
      await pg.getByTestId('profile-menu-open').click();
      await pg.getByRole('menuitem', { name: /Корзина/ }).click();
      await pg.getByTestId('trash-page').locator('.g-sugg', { hasText: 'Beta' }).waitFor();
    } finally { await ctx.close(); }
  });

  await check('Trash auto-cleanup removes only entries older than the chosen period', async () => {
    const day = 24 * 60 * 60 * 1000;
    const agedSeed = (days) => {
      const now = Date.now();
      const s = seedProfiles({
        profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
        stores: { p1: v5store([seedNote('a', 'Alpha', { content: '<p>alpha body</p>', text: 'alpha body' })], 'a', {
          trash: [seedNote('old', 'Old note'), seedNote('fresh', 'Fresh note'), seedNote('undated', 'Undated note')],
          trashMeta: { old: { incoming: [], graphs: [], at: now - 40 * day }, fresh: { incoming: [], graphs: [], at: now - 2 * day } },
          trashTasks: [{ id: 'tOld', text: 'Old task', done: false, trashedAt: now - 45 * day }, { id: 'tNew', text: 'New task', done: false, trashedAt: now - day }],
        }) },
        prefs: days ? { 'grafnot-trash-days:p1': String(days) } : {},
      });
      return s;
    };
    const ids = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('grafnot-store-p1')); return { notes: s.trash.map(n => n.id).sort().join(), tasks: s.trashTasks.map(t => t.id).sort().join() }; });
    // Off by default: nothing disappears.
    await reseed(page, agedSeed(0));
    await page.goto(t.URL + '#/trash', { waitUntil: 'networkidle' });
    await page.getByTestId('trash-page').locator('.g-sugg', { hasText: 'Old note' }).waitFor();
    assert((await ids()).notes === 'fresh,old,undated', 'cleanup ran while off');
    // Choosing 30 days removes the old note and task at once; undated stays.
    await page.getByTestId('trash-autoclean').selectOption('30');
    await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('grafnot-store-p1')); return !s.trash.some(n => n.id === 'old') && !s.trashTasks.some(t => t.id === 'tOld'); }, null, { timeout: 8000 });
    const after = await ids();
    assert(after.notes === 'fresh,undated' && after.tasks === 'tNew', 'cleanup removed the wrong entries: ' + JSON.stringify(after));
    // A stored period also applies when the profile opens.
    await reseed(page, agedSeed(30));
    await page.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('grafnot-store-p1')); return !s.trash.some(n => n.id === 'old'); }, null, { timeout: 8000 });
    assert((await ids()).notes === 'fresh,undated', 'startup cleanup wrong');
  });

  await check('D3 restore keeps edits made after the deletion', async () => {
    await reseed(page, seed());
    await deleteBeta();
    await page.evaluate(() => { window.location.hash = '#/notes/a'; });
    await titleIs('Alpha');
    await page.locator('.tiptap').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' EDITED');
    await waitStore(() => (JSON.parse(window.localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'a') || {}).text.includes('EDITED'), 'Alpha edit not saved');
    await restoreBetaFromTrash();
    await page.waitForTimeout(600);
    const s = await storeOf();
    assert(s.notes.find((x) => x.id === 'a').text.includes('EDITED'), 'restore rolled back the Alpha edit');
    assertRestored(s, 'after edit');
  });
};
