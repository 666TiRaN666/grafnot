// E2E group G4-story (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { MAP_UNLOCK, seedProfiles, v5store, storyEntryNotes, storyGrownLegacy, reseed, beginGroup, check, assert, newViaPalette, pickViaPalette, page } = t;

  // ---------- GROUP G4-story: Alpha/Beta entry (lock toast), growth in P7 ----------
  await beginGroup('G4-story', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store(storyEntryNotes(), 'b1') },
  }));

  await check('P7 map real clusters', async () => {
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    // S10: no lock anymore (MAP_UNLOCK=0); an unlinked canvas shows guidance.
    assert((await page.getByTestId('map-view').innerText()).includes('Соедините заметки'), 'no empty hint');
    await reseed(page, storyGrownLegacy());
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    const t = await page.getByTestId('map-view').innerText();
    assert(!t.includes('128'), 'fake count present');
    assert(t.includes('(' + (MAP_UNLOCK + 1) + ')'), `real count missing: ${t.slice(0, 200)}`);
    assert((await page.getByTestId('map-orphans').innerText()).includes('(' + (MAP_UNLOCK + 1) + ')'), 'unlinked wrong');
  });
  await check('P7 similar real', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    await page.locator('.g-right').waitFor();
    await page.getByTestId('ctx-tab-similar').click();
    const t = await page.locator('.g-right').innerText();
    assert(t.includes('Alpha'), 'real similar missing');
    assert(!t.includes('Normalization'), 'fake similar present');
  });
  await check('P7 broken flow', async () => {
    await page.locator('.tiptap').click();
    await page.keyboard.type('[[Alpha');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await page.getByTestId('ctx-tab-links').click();
    await page.locator('.g-card', { hasText: 'Связанное' }).locator('li', { hasText: 'Alpha' }).locator('.g-linkbtn').click();
    await page.getByTestId('notes-more').click();
    await page.getByTestId('notes-menu-trash').click();
    await page.getByTestId('nav-map').click();
    await page.locator('svg.g-canvas').waitFor();
    assert((await page.locator('.g-brokenrow').count()) === 0, 'dangling refs remain');
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-notes-tools .g-in').fill('Beta');
    await page.locator('.g-noterow', { hasText: 'Beta' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-card', { hasText: 'Связанное' }).locator('li').count()) === 0, 'refs not purged');
  });
  await check('P7 rename propagation', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Delta');
    await page.locator('.tiptap').click();
    await page.keyboard.type('[[Beta');
    await page.getByTestId('link-suggest').waitFor();
    await page.keyboard.press('Enter');
    await pickViaPalette(page, 'Beta', 'Beta');
    await page.locator('.g-title-in').fill('Gamma');
    await page.keyboard.press('Enter');
    await pickViaPalette(page, 'Delta', 'Delta');
    await page.getByTestId('ctx-tab-links').click();
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Gamma') && !t.includes('Beta'), `refs not updated: ${t}`);
  });
  await check('P7 unique titles', async () => {
    await newViaPalette(page);
    await page.locator('.g-title-in').fill('Gamma');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => (document.querySelector('.g-title-in') || {}).value === 'Gamma 2',
      null,
      { timeout: 5000 },
    );
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Gamma 2', `not uniquified: ${v}`);
  });



  await check('P8 rename UX: clear-type-commit', async () => {
    await page.locator('.g-title-in').fill('');
    await page.keyboard.type('Completely New');
    await page.keyboard.press('Enter');
    const v = await page.locator('.g-title-in').inputValue();
    assert(v === 'Completely New', `reverted: ${v}`);
    await page.locator('.g-title-in').fill('Completely Ne');
    const v2 = await page.locator('.g-title-in').inputValue();
    assert(v2 === 'Completely Ne', `jumped while typing: ${v2}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => (document.querySelector('.g-title-in') || {}).value === 'Completely New',
      null,
      { timeout: 5000 },
    );
    const v3 = await page.locator('.g-title-in').inputValue();
    assert(v3 === 'Completely New', `escape did not revert: ${v3}`);
  });


  await check('P9 rail collapse + persist', async () => {
    await page.locator('.s-rail').getByLabel('Меню').click();
    await page.locator('.s-rail.collapsed').waitFor();
    assert((await page.locator('.s-rail .s-navlbl').count()) === 0, 'labels visible in rail');
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.s-rail.collapsed').waitFor();
  });
  await check('P9 create from rail', async () => {
    await page.getByTestId('quickadd').click();
    await page.getByTestId('palette').waitFor();
    await page.getByTestId('palette').getByRole('button', { name: '+ Новая заметка' }).click();
    await page.locator('.g-title-in').waitFor();
    await page.locator('.s-rail').getByLabel('Меню').click();
    assert((await page.locator('.s-rail.collapsed').count()) === 0, 'not expanded');
  });
  await check('P9 center capped', async () => {
    const mw = await page.evaluate(() => getComputedStyle(document.querySelector('.n-editor')).maxWidth);
    assert(mw === '860px', `maxWidth ${mw}`);
  });



  await check('P11 notes list open+delete', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    assert((await page.locator('.g-noterow').count()) >= 3, 'few rows');
    await page.locator('.g-noterow', { hasText: 'Gamma' }).first().locator('.g-noteopen').click();
    assert((await page.locator('.g-title-in').inputValue()) === 'Gamma', 'not opened');
  });
  await check('P11 backlinks both ways', async () => {
    const t = await page.locator('.g-card', { hasText: 'Связанное' }).innerText();
    assert(t.includes('Delta'), `no incoming: ${t}`);
  });


  await check('P12 graph create+rename', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: '+ Новый' }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Переименовать' }).click();
    await page.locator('.g-gtitle-in').fill('Math');
    await page.keyboard.press('Enter');
    assert((await page.getByTestId('map-graphs').innerText()).includes('Math'), 'no Math tab');
  });
  await check('P12 assign isolates nodes', async () => {
    const st = async (n, f) => { try { await f(); } catch (e) { throw new Error(n + ' :: ' + String(e).split('\n')[0]); } };
    await st('open-members', async () => {
      await page.getByTestId('map-menu').click();
      await page.getByRole('menuitem', { name: 'Состав' }).click();
      await page.getByTestId('map-members').waitFor({ timeout: 8000 });
    });
    await st('check-gamma', async () => {
      await page.locator('.g-memberrow', { hasText: 'Gamma' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('check-delta', async () => {
      await page.locator('.g-memberrow', { hasText: 'Delta' }).first().locator('input').check({ timeout: 8000 });
    });
    await st('close-drawer', async () => {
      await page.keyboard.press('Escape');
      await page.getByTestId('map-members').waitFor({ state: 'detached', timeout: 8000 });
    });
    assert((await page.locator('circle.g-vnode').count()) === 2, 'not isolated');
    assert((await page.locator('line.g-vedge').count()) >= 1, 'no edges in Math');
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /HCI/ }).click();
    const hci = await page.locator('circle.g-vnode').count();
    assert(hci > 2, `HCI small: ${hci}`);
  });
  await check('P12 zoom+drag', async () => {
    const before = await page.locator('g.g-view').getAttribute('transform');
    await page.getByLabel('Приблизить').click();
    const after = await page.locator('g.g-view').getAttribute('transform');
    assert(before !== after && (after || '').includes('1.25'), `no zoom: ${after}`);
    // Drag the node farthest from the canvas center toward it: edge nodes
    // plus an outward vector would leave the viewport and drop the gesture.
    // Only fully visible nodes qualify (outside the svg the press lands on
    // the shell; under the floating toolbar it lands on the toolbar).
    const grab = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let best = null;
      for (const c of svg.querySelectorAll('circle.g-vnode')) {
        const b = c.getBoundingClientRect();
        const x = b.left + b.width / 2;
        const y = b.top + b.height / 2;
        if (x < r.left + 30 || x > r.right - 30 || y < r.top + 30 || y > r.bottom - 110) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (!best || d > best.d) best = { id: c.getAttribute('data-id'), x, y, d };
      }
      return { node: best, center: { x: cx, y: cy } };
    });
    assert(!!grab.node && grab.node.d > 4, 'no draggable node');
    const c0 = page.locator(`circle.g-vnode[data-id="${grab.node.id}"]`);
    const cx0 = await c0.getAttribute('cx');
    await page.mouse.move(grab.node.x, grab.node.y);
    await page.mouse.down();
    await page.mouse.move(grab.center.x, grab.center.y, { steps: 8 });
    await page.mouse.up();
    const cx1 = await c0.getAttribute('cx');
    assert(cx0 !== cx1, 'drag did not move');
  });

  await check('P12 hit zone r24', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByTestId('map-graphs-pop').getByRole('menuitem', { name: /Math/ }).click();
    // The scope switch resets pan/zoom asynchronously (canvas view effect):
    // geometry must be read after the reset lands, never on a stale
    // transform left by P12 zoom+drag (STAGE_11 flake root cause).
    await page.waitForFunction(
      () => document.querySelector('g.g-view')?.getAttribute('transform') === 'translate(0 0) scale(1)',
      null,
      { timeout: 8000 },
    );
    const pt = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const cc = svg.querySelector('circle.g-vnode');
      const r = svg.getBoundingClientRect();
      const s = Math.min(r.width / 800, r.height / 500);
      const ox = (r.width - 800 * s) / 2, oy = (r.height - 500 * s) / 2;
      const g = svg.querySelector('g.g-view');
      const mm = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute('transform'));
      const tx = +mm[1], ty = +mm[2], k = +mm[3];
      const cx = +cc.getAttribute('cx'), cy = +cc.getAttribute('cy');
      return { x: r.left + ox + (cx * k + tx) * s + 20 * s * k, y: r.top + oy + (cy * k + ty) * s };
    });
    await page.mouse.click(pt.x, pt.y);
    // S10: node clicks open the peek drawer (preview cards deleted).
    await page.getByTestId('map-peek').waitFor();
    const sel = await page.getByTestId('map-peek').innerText();
    assert(sel.includes('Gamma') || sel.includes('Delta'), `wrong selection: ${sel.slice(0, 80)}`);
  });
  await check('P12 pan moves canvas', async () => {
    const before = await page.locator('g.g-view').getAttribute('transform');
    const pt = await page.evaluate(() => {
      const svg = document.querySelector('svg.g-canvas');
      const r = svg.getBoundingClientRect();
      const spots = [[10, 10], [r.width - 10, 10], [10, r.height - 10]];
      for (const [x, y] of spots) {
        const el = document.elementFromPoint(r.left + x, r.top + y);
        if (el && (el === svg || el.tagName === 'svg')) return { x: r.left + x, y: r.top + y };
      }
      return { x: r.left + 10, y: r.top + 10 };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 120, pt.y + 60, { steps: 10 });
    await page.mouse.up();
    const after = await page.locator('g.g-view').getAttribute('transform');
    assert(before !== after, 'pan did not move');
  });


  await check('P12 ungrouped regression', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: '+ Новый' }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    const countUngrouped = async () => {
      await page.getByTestId('map-graphs').click();
      const t = await page.getByTestId('map-graphs-pop').innerText();
      await page.keyboard.press('Escape');
      const m = /Без графа \((\d+)\)/.exec(t);
      return m ? Number(m[1]) : -1;
    };
    const before = await countUngrouped();
    await newViaPalette(page);
    await page.getByTestId('nav-map').click();
    assert((await countUngrouped()) === before + 1, 'new note not ungrouped');
  });

  await check('P12 delete keeps notes', async () => {
    await page.getByTestId('nav-map').click();
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: /Math/ }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    const before = await page.locator('.g-noterow').count();
    await page.getByTestId('nav-map').click();
    // P4: the ungrouped check above also deletes a graph; its undo-toast may
    // still live out the 8s TTL here. Dismiss all visible toasts first so the
    // delete below owns the only undo-toast (observable, no timers).
    for (const x of await page.locator('.g-toast .g-toast-x').all()) {
      await x.click();
    }
    await page.waitForFunction(() => document.querySelectorAll('.g-toast').length === 0, null, { timeout: 8000 });
    await page.getByTestId('map-graphs').click();
    await page.getByRole('menuitem', { name: /Math/ }).click();
    await page.getByTestId('map-menu').click();
    await page.getByRole('menuitem', { name: 'Удалить граф' }).click();
    // P4: an earlier undo-toast may still live out its 8s TTL here; scope to
    // this delete's own toast by its text instead of assuming a single toast.
    await page.locator('.g-toast', { hasText: 'Граф удалён, заметки сохранены' }).locator('.g-toast-undo').waitFor();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow').first().waitFor();
    const after = await page.locator('.g-noterow').count();
    assert(before === after && before > 0, `notes lost: ${before} vs ${after}`);
  });
};
