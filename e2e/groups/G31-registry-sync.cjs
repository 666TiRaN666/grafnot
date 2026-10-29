// E2E group G31-registry-sync (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, v5store, seedNote, groupActive, storageStateFor, check, assert, browser } = t;

  // ---------- GROUP G31-registry-sync: registry operations use the latest shared state ----------
  if (await groupActive('G31-registry-sync')) {
    // W13: no known last profile, so both tabs start on the picker.
    const registrySeed = () => seedProfiles({ profiles: [{ id: 'p1', name: 'One', created: 1 }, { id: 'p2', name: 'Two', created: 2 }], activeId: '', stores: { p1: v5store([seedNote('n1', 'One note')], 'n1'), p2: v5store([seedNote('n2', 'Two note')], 'n2') } });
    const createNamed = async (pg, name) => {
      await pg.getByTestId('profile-name-in').fill(name);
      await pg.getByTestId('profile-name-in').press('Enter');
      await pg.getByTestId('profile-picker').waitFor({ state: 'detached' });
    };
    await check('F1 two tabs preserve both created profiles and saved data', async () => {
      const isolated = await browser.newContext({ storageState: storageStateFor(registrySeed()) });
      try {
        const a = await isolated.newPage(), b = await isolated.newPage();
        attachErrorGuards(a); attachErrorGuards(b);
        await a.goto(URL, { waitUntil: 'networkidle' }); await b.goto(URL, { waitUntil: 'networkidle' });
        await a.bringToFront(); await createNamed(a, 'Parallel A');
        const idA = await a.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).activeId);
        await a.keyboard.press('Control+Alt+n'); await a.getByTestId('title-in').fill('Data of parallel A'); await a.getByTestId('title-in').press('Enter');
        await a.waitForFunction(id => localStorage.getItem('grafnot-store-' + id)?.includes('Data of parallel A'), idA);
        await b.bringToFront(); await createNamed(b, 'Parallel B');
        const state = await b.evaluate(idA => ({ profiles: JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles, dataA: localStorage.getItem('grafnot-store-' + idA) }), idA);
        assert(state.profiles.some(p => p.name === 'Parallel A'), 'first created profile lost from registry');
        assert(state.profiles.some(p => p.name === 'Parallel B') && state.profiles.length === 4, 'second creation or original profiles lost');
        assert(state.dataA.includes('Data of parallel A'), 'first profile data lost');
        await a.getByTestId('nav-settings').click(); await a.getByTestId('settings-nav-profiles').click();
        await a.getByTestId('settings-page').getByText('Parallel B', { exact: true }).waitFor();
      } finally { await isolated.close(); }
    });
    await check('F1 deleted active profile retains unsaved data and blocks overwrite', async () => {
      const isolated = await browser.newContext({ storageState: storageStateFor(registrySeed()) });
      try {
        const a = await isolated.newPage(), b = await isolated.newPage(); attachErrorGuards(a); attachErrorGuards(b);
        await a.goto(URL, { waitUntil: 'networkidle' }); await b.goto(URL, { waitUntil: 'networkidle' });
        await a.bringToFront(); await a.getByTestId('profile-row-p1').getByRole('button', { name: 'Войти' }).click();
        await a.getByTestId('note-item').filter({ hasText: 'One note' }).click();
        await a.getByTestId('title-in').fill('Unsaved before external deletion'); await a.getByTestId('title-in').press('Enter');
        // Script-speed deletion keeps this deterministic inside the save debounce.
        await b.evaluate(() => {
          const reg = JSON.parse(localStorage.getItem('grafnot-profiles-v1'));
          reg.profiles = reg.profiles.filter(p => p.id !== 'p1'); reg.activeId = 'p2';
          localStorage.setItem('grafnot-profiles-v1', JSON.stringify(reg)); localStorage.removeItem('grafnot-store-p1');
        });
        await a.getByTestId('save-state').filter({ hasText: 'Конфликт' }).waitFor();
        assert(await a.getByRole('button', { name: 'Перезаписать моей', exact: true }).isDisabled(), 'deleted profile can be overwritten');
        const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'Скачать данные', exact: true }).click()]);
        const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
        assert(JSON.parse(Buffer.concat(chunks).toString('utf8')).notes[0].title === 'Unsaved before external deletion', 'unsaved memory snapshot lost');
        await a.waitForTimeout(600); assert(await a.evaluate(() => localStorage.getItem('grafnot-store-p1')) === null, 'removed store was recreated');
        await a.getByRole('button', { name: 'Принять чужую версию', exact: true }).click(); await a.getByRole('button', { name: 'Всё равно перейти', exact: true }).click();
        await a.getByTestId('profile-picker').waitFor(); assert(await a.getByTestId('profile-row-p1').count() === 0, 'deleted profile reappeared');
      } finally { await isolated.close(); }
    });
    await check('F1 stale tab cannot resurrect a deleted profile', async () => {
      const isolated = await browser.newContext({ storageState: storageStateFor(registrySeed()) });
      try {
        const a = await isolated.newPage(), b = await isolated.newPage(); attachErrorGuards(a); attachErrorGuards(b);
        await a.goto(URL, { waitUntil: 'networkidle' }); await b.goto(URL, { waitUntil: 'networkidle' });
        await a.bringToFront(); const row = a.getByTestId('profile-row-p2');
        await row.getByRole('button', { name: 'Удалить навсегда' }).click(); await row.getByRole('button', { name: 'Точно?' }).click(); await row.waitFor({ state: 'detached' });
        await b.bringToFront(); await b.getByTestId('profile-row-p1').getByRole('button', { name: 'Войти' }).click(); await b.getByTestId('note-item').filter({ hasText: 'One note' }).waitFor();
        const state = await b.evaluate(() => ({ ids: JSON.parse(localStorage.getItem('grafnot-profiles-v1')).profiles.map(p => p.id), deleted: localStorage.getItem('grafnot-store-p2') }));
        assert(state.ids.join(',') === 'p1', 'deleted profile resurrected by stale registry write'); assert(state.deleted === null, 'deleted data unexpectedly recreated');
      } finally { await isolated.close(); }
    });
  }
};
