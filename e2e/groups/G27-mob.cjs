// E2E group G27-mob (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, v5store, seedNote, beginGroup, storageStateFor, check, assert, browser } = t;

  // ---------- GROUP G27-mob: S11 mobile pass on two viewports ----------
  // Coarse-pointer CSS only applies in mobile emulation: both contexts use
  // isMobile + touch, like a real phone (plain small viewports would not).
  await beginGroup('G27-mob', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha note with a fairly long title', { text: 'alpha body', updated: 2 }),
          seedNote('b1', 'Beta', { updated: 1 }),
        ],
        'a1',
        {
          tasks: [{ id: 't1', text: 'Today run task', done: false }],
          graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
        },
      ),
    },
  }));
  const mobCtx = (w, h) => browser.newContext({
    viewport: { width: w, height: h }, isMobile: true, hasTouch: true,
    storageState: storageStateFor(seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
      activeId: 'p1',
      stores: {
        p1: v5store(
          [
            seedNote('a1', 'Alpha note with a fairly long title', { text: 'alpha body', updated: 2 }),
            seedNote('b1', 'Beta', { updated: 1 }),
          ],
          'a1',
          {
            tasks: [{ id: 't1', text: 'Today run task', done: false }],
            graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }],
          },
        ),
      },
    })),
  });
  const noOverflow = async (pg, where, w) => {
    const bad = await pg.evaluate((want) => {
      const de = document.documentElement;
      if (window.innerWidth > want + 1) return `viewport expanded: ${window.innerWidth}>${want}`;
      return de.scrollWidth <= window.innerWidth + 1 ? null : `${de.scrollWidth}>${window.innerWidth}`;
    }, w);
    assert(bad === null, `horizontal overflow at ${where}: ${bad}`);
  };

  await check('S11 no horizontal overflow', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await noOverflow(m, 'notes', 390);
      await m.getByTestId('tab-plan').click();
      await noOverflow(m, 'plan-list', 390);
      await m.getByTestId('plan-view-week').click();
      await noOverflow(m, 'plan-week', 390);
      await m.getByTestId('tab-map').click();
      await noOverflow(m, 'map', 390);
      await m.getByTestId('tab-prompts').click();
      await noOverflow(m, 'prompts', 390);
      await m.evaluate(() => { window.location.hash = '#/settings/profiles'; });
      await m.getByTestId('settings-page').waitFor();
      await noOverflow(m, 'settings', 390);
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 notes drilldown', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      assert((await m.getByTestId('note-list').count()) === 0 || !(await m.getByTestId('note-list').isVisible()), 'list not hidden');
      await m.getByTestId('notes-back').click();
      await m.getByTestId('note-list').waitFor();
      assert(await m.getByTestId('note-list').isVisible(), 'list not back');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 plan add above tabbar', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-plan').click();
      await m.getByTestId('task-composer').click();
      await m.getByTestId('task-composer-title').fill('Mobile task');
      await m.getByTestId('task-add').click();
      await m.locator('[data-testid="task-row"]', { hasText: 'Mobile task' }).waitFor();
      assert(await m.getByTestId('tabbar').isVisible(), 'tabbar gone');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 palette quickadd mobile', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-add').click();
      await m.getByTestId('palette').waitFor();
      const w = await m.getByTestId('palette').evaluate((el) => el.getBoundingClientRect().width);
      assert(w >= 300, `palette narrow: ${w}`);
      await m.keyboard.press('Escape');
      assert((await m.getByTestId('palette').count()) === 0, 'palette stuck');
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 targets coarse', async () => {
    const ctx = await mobCtx(390, 844);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      const sizes = await m.evaluate(() => {
        const out = {};
        for (const [name, sel] of [['title', '.g-title-in'], ['back', '[data-testid="notes-back"]'], ['search', '[data-testid="task-search"]']]) {
          const el = document.querySelector(sel);
          out[name] = el ? Math.round(el.getBoundingClientRect().height) : -1;
        }
        return out;
      });
      // task-search lives on the plan section: measure it there.
      await m.getByTestId('tab-plan').click();
      // P4: the plan chunk loads lazily; measuring before it mounts reads -1.
      await m.getByTestId('task-search').waitFor();
      const searchH = await m.evaluate(() => {
        const el = document.querySelector('[data-testid="task-search"]');
        return el ? Math.round(el.getBoundingClientRect().height) : -1;
      });
      assert(sizes.title >= 44, `title short: ${sizes.title}`);
      assert(sizes.back >= 44, `back short: ${sizes.back}`);
      assert(searchH >= 44, `search short: ${searchH}`);
    } finally {
      await m.close();
      await ctx.close();
    }
  });

  await check('S11 narrow overflow drilldown', async () => {
    const ctx = await mobCtx(360, 740);
    const m = await ctx.newPage();
    attachErrorGuards(m);
    await m.goto(URL, { waitUntil: 'networkidle' });
    try {
      await m.getByTestId('tab-notes').click();
      await noOverflow(m, 'notes-360');
      await m.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
      await m.locator('.g-title-in').waitFor();
      await noOverflow(m, 'editor-360', 360);
      assert((await m.getByTestId('note-list').count()) === 0 || !(await m.getByTestId('note-list').isVisible()), 'list not hidden 360');
    } finally {
      await m.close();
      await ctx.close();
    }
  });
};
