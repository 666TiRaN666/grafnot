// E2E group G26-map (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G26-map: S10 canvas search, link drag, members, delete, orphans ----------
  await beginGroup('G26-map', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store(
        [
          seedNote('a1', 'Alpha', { updated: 3 }),
          seedNote('b1', 'Beta', { updated: 2 }),
          seedNote('c1', 'Gamma', { linkedIds: ['a1'], updated: 1 }),
        ],
        'a1',
        { graphs: [{ id: 'g1', title: 'Team', noteIds: ['a1'] }] },
      ),
    },
  }));
  const mapTransform = () => page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'));

  await check('S10 node search centers', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    await page.keyboard.press('/');
    await page.waitForFunction(() => (document.activeElement || {}).getAttribute?.('data-testid') === 'map-search', null, { timeout: 8000 });
    const before = await mapTransform();
    await page.getByTestId('map-search').fill('Alpha');
    await page.keyboard.press('Enter');
    await page.getByTestId('map-peek').waitFor();
    assert((await page.getByTestId('map-peek').innerText()).includes('Alpha'), 'wrong peek');
    assert((await mapTransform()) !== before, 'canvas did not move');
  });

  await check('S10 drag links with undo', async () => {
    const edges = () => page.locator('.g-vedge').count();
    assert((await edges()) === 1, 'seed edge missing');
    await page.getByTestId('map-link').click();
    const pa = await page.locator('circle.g-vnode[data-id="a1"]').boundingBox();
    const pb = await page.locator('circle.g-vnode[data-id="b1"]').boundingBox();
    assert(!!pa && !!pb, 'no node geometry');
    await page.mouse.move(pa.x + pa.width / 2, pa.y + pa.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('.g-vedge').length === 2, null, { timeout: 8000 });
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    await page.waitForFunction(() => document.querySelectorAll('.g-vedge').length === 1, null, { timeout: 8000 });
  });

  await check('S10 members compose', async () => {
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: /Team/ }).click();
    assert((await page.locator('circle.g-vnode').count()) === 1, 'scope not applied');
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Состав' }).click();
    await page.getByTestId('map-members').waitFor();
    await page.locator('.g-memberrow', { hasText: 'Beta' }).locator('input').check();
    await page.waitForFunction(() => document.querySelectorAll('circle.g-vnode').length === 2, null, { timeout: 8000 });
    await page.locator('.g-memberrow', { hasText: 'Beta' }).locator('input').uncheck();
    await page.waitForFunction(() => document.querySelectorAll('circle.g-vnode').length === 1, null, { timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  await check('S10 delete graph undo', async () => {
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    await page.getByTestId('map-graphs').click();
    assert((await page.getByTestId('map-graphs-pop').innerText()).includes('Team') === false, 'graph not deleted');
    await page.keyboard.press('Escape');
    await page.locator('.g-toast-undo').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Team/ }).waitFor();
    await page.keyboard.press('Escape');
  });

  await check('S10 orphans chip highlights', async () => {
    const chip = page.getByTestId('map-orphans');
    await chip.waitFor();
    assert((await chip.innerText()).includes('(1)'), 'wrong orphan count');
    await chip.click();
    assert(((await page.locator('circle.g-vnode[data-id="b1"]').getAttribute('class')) || '').includes('hl'), 'orphan not highlighted');
  });

  await check('Map physics: a drag pulls linked notes, a pinned note holds and stays pinned after reload', async () => {
    await t.reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
      stores: { p1: v5store([
        seedNote('a', 'Alpha', { linkedIds: ['b', 'c'] }),
        seedNote('b', 'Beta'),
        seedNote('c', 'Gamma', { linkedIds: ['b'] }),
      ], 'a') },
    }));
    await page.goto(t.URL + '#/map', { waitUntil: 'networkidle' });
    await page.locator('svg.g-canvas').waitFor();
    const at = (id) => page.locator(`circle.g-vnode[data-id="${id}"]`).evaluate((el) => ({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) }));
    // Pin Gamma through its card.
    const gc = await page.locator('circle.g-vnode[data-id="c"]').boundingBox();
    await page.mouse.click(gc.x + gc.width / 2, gc.y + gc.height / 2);
    await page.getByTestId('map-pin').click();
    assert(await page.getByTestId('map-pin').getAttribute('aria-pressed') === 'true', 'pin not shown as pressed');
    await page.locator('g[data-node="c"][data-pinned="true"]').waitFor();
    await page.keyboard.press('Escape');
    const c0 = await at('c'), b0 = await at('b');
    // Drag Alpha far to the side.
    const ga = await page.locator('circle.g-vnode[data-id="a"]').boundingBox();
    const sx = ga.x + ga.width / 2, sy = ga.y + ga.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 180, sy + 60, { steps: 12 });
    await page.waitForTimeout(800);
    // While Alpha is held, its springs pull Beta; released, the group settles
    // back around the pinned Gamma, so the pull is measured during the hold.
    const b1 = await at('b'), held = await at('c');
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const c1 = await at('c');
    assert(Math.hypot(b1.x - b0.x, b1.y - b0.y) > 15, 'linked note did not follow the drag');
    assert(Math.hypot(held.x - c0.x, held.y - c0.y) < 0.5 && Math.hypot(c1.x - c0.x, c1.y - c0.y) < 0.5, 'pinned note moved');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('g[data-node="c"][data-pinned="true"]').waitFor();
    const c2 = await at('c');
    assert(Math.hypot(c2.x - c0.x, c2.y - c0.y) < 0.5, 'pin position lost on reload');
  });

  await check('Map: two-way link drawn once with two arrows, full label on hover, pin all and reset with Undo', async () => {
    const long = 'Конспект лекции по взаимодействию человека и компьютера';
    await t.reseed(page, seedProfiles({
      profiles: [{ id: 'p1', name: 'Основной', created: 1 }], activeId: 'p1',
      stores: { p1: v5store([
        seedNote('a', long, { linkedIds: ['b'] }),
        seedNote('b', 'Beta', { linkedIds: ['a'] }),
        seedNote('c', 'Gamma', { linkedIds: ['a'] }),
      ], 'a') },
    }));
    await page.goto(t.URL + '#/map', { waitUntil: 'networkidle' });
    await page.locator('svg.g-canvas').waitFor();
    const both = page.locator('.g-vedge.both');
    assert(await both.count() === 1, 'two-way link not drawn as one bowed edge');
    assert(!!(await both.getAttribute('marker-start')), 'two-way link lacks its second arrow');
    assert(await page.locator('.g-vedge').count() === 2, 'edge count changed');
    const label = () => page.locator('text[data-label="a"]').textContent();
    assert((await label()).endsWith('…'), 'idle label not shortened');
    await page.locator('g[data-node="a"] circle.g-vnode').hover();
    await page.waitForFunction((full) => document.querySelector('text[data-label="a"]')?.textContent === full, long);
    await page.mouse.move(2, 2);
    await page.getByTestId('map-menu').click();
    await page.getByTestId('map-pin-all').click();
    await page.waitForFunction(() => document.querySelectorAll('g[data-pinned="true"]').length === 3);
    await page.getByTestId('map-menu').click();
    await page.getByTestId('map-reset-layout').click();
    await page.waitForFunction(() => !document.querySelector('g[data-pinned="true"]'));
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('g[data-pinned="true"]').length === 3);
  });

  await check('Map: Ctrl+click and box select, bulk pin and unpin, Esc clears', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    await page.locator('[aria-label="Вписать"]').click();
    await page.waitForTimeout(400);
    const center = async (id) => { const b = await page.locator(`circle.g-vnode[data-id="${id}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const sel = () => page.evaluate(() => [...document.querySelectorAll('circle.g-vnode.sel')].map((c) => c.dataset.id).sort().join(','));
    const ids = await page.evaluate(() => [...document.querySelectorAll('circle.g-vnode')].map((c) => c.dataset.id));
    const [a, b] = ids;
    const pa = await center(a), pb = await center(b);
    await page.mouse.click(pa.x, pa.y);
    await page.keyboard.down('Control');
    await page.mouse.click(pb.x, pb.y);
    await page.keyboard.up('Control');
    assert((await sel()) === [a, b].sort().join(','), 'Ctrl+click did not add to the selection: ' + (await sel()));
    await page.getByTestId('map-sel-bar').waitFor();
    const allPinned = (on) => page.waitForFunction(([k, v]) => k.every((id) => !!document.querySelector(`g[data-node="${id}"][data-pinned="true"]`) === v), [[a, b], on], { timeout: 5000 });
    // Earlier checks may leave pins: start from none, then pin both, then unpin both.
    if (await page.getByTestId('map-sel-unpin').isEnabled()) await page.getByTestId('map-sel-unpin').click();
    await allPinned(false);
    await page.getByTestId('map-sel-pin').click();
    await allPinned(true);
    await page.getByTestId('map-sel-unpin').click();
    await allPinned(false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('circle.g-vnode.sel').length === 0, null, { timeout: 5000 });
    // A box over the whole canvas in box mode: every node, and the view does not pan.
    const before = await page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'));
    const box = await page.locator('svg.g-canvas').boundingBox();
    await page.getByTestId('map-box').click();
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 8 });
    await page.mouse.up();
    assert((await sel()).split(',').length === ids.length, 'box did not select every node: ' + (await sel()));
    assert((await page.evaluate(() => document.querySelector('g.g-view')?.getAttribute('transform'))) === before, 'box select panned the map');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert((await page.getByTestId('map-box').getAttribute('aria-pressed')) === 'false', 'Esc did not leave box mode');
  });
};
