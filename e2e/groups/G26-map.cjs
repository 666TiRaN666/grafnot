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
    const edges = () => page.locator('line.g-vedge').count();
    assert((await edges()) === 1, 'seed edge missing');
    await page.getByTestId('map-link').click();
    const pa = await page.locator('circle.g-vnode[data-id="a1"]').boundingBox();
    const pb = await page.locator('circle.g-vnode[data-id="b1"]').boundingBox();
    assert(!!pa && !!pb, 'no node geometry');
    await page.mouse.move(pa.x + pa.width / 2, pa.y + pa.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('line.g-vedge').length === 2, null, { timeout: 8000 });
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    await page.waitForFunction(() => document.querySelectorAll('line.g-vedge').length === 1, null, { timeout: 8000 });
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
};
