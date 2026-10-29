// E2E group G30-rest (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, v5store, seedNote, groupActive, storageStateFor, check, assert, newViaPalette, browser } = t;

  // ---------- GROUP G30-rest: unknown fields follow the loaded profile snapshot ----------
  if (await groupActive('G30-rest')) {
    const extra = { extensionData: { owner: 'one', nested: [null, false, { keep: 'value' }] }, emptyExtension: null };
    const restStore = (title, extras) => v5store([seedNote('rest-note', title)], 'rest-note', extras);
    const oneSeed = () => seedProfiles({ profiles: [{ id: 'rest-one', name: 'One', created: 1 }], activeId: 'rest-one', stores: { 'rest-one': restStore('Rest original', extra) } });
    const openRest = async (pg, title) => {
      await pg.getByTestId('nav-notes').click();
      await pg.getByTestId('note-item').filter({ hasText: title }).click();
      await pg.getByTestId('title-in').waitFor();
    };
    const editRest = async (pg, title) => {
      await pg.getByTestId('title-in').fill(title);
      await pg.getByTestId('title-in').press('Enter');
    };
    const savedRest = (pg, id, title) => pg.waitForFunction(({ id, title }) => {
      const raw = localStorage.getItem('grafnot-store-' + id);
      return raw && JSON.parse(raw).notes[0].title === title;
    }, { id, title });
    const rawRest = (pg, id) => pg.evaluate((id) => JSON.parse(localStorage.getItem('grafnot-store-' + id)), id);
    const checkExtra = (raw, expected) => {
      for (const key of ['extensionData', 'emptyExtension', 'otherExtension']) {
        assert(JSON.stringify(raw[key]) === JSON.stringify(expected[key]), 'unknown field changed: ' + key);
      }
    };
    const pickerRest = async (pg) => {
      await pg.getByTestId('nav-settings').click();
      await pg.getByTestId('settings-page').waitFor();
      await pg.getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await pg.getByRole('dialog').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await pg.getByTestId('profile-picker').waitFor();
    };
    const enterRest = async (pg, id) => {
      await pg.getByTestId('profile-row-' + id).getByRole('button', { name: 'Войти' }).click();
    };
    const memoryRest = async (pg) => {
      const [download] = await Promise.all([
        pg.waitForEvent('download'),
        pg.getByRole('button', { name: 'Скачать данные', exact: true }).click(),
      ]);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };
    await check('rest survives autosave, failed-save export, retry and reload', async () => {
      const isolated = await browser.newContext({ storageState: storageStateFor(oneSeed()) });
      try {
        const probe = await isolated.newPage(); attachErrorGuards(probe);
        await probe.goto(URL, { waitUntil: 'networkidle' });
        await openRest(probe, 'Rest original');
        await editRest(probe, 'Rest autosaved');
        await savedRest(probe, 'rest-one', 'Rest autosaved');
        checkExtra(await rawRest(probe, 'rest-one'), extra);
        await probe.evaluate(() => {
          const set = Storage.prototype.setItem;
          window.restoreRestWrites = () => { Storage.prototype.setItem = set; };
          Storage.prototype.setItem = function (key, value) {
            if (key === 'grafnot-store-rest-one') throw new DOMException('quota', 'QuotaExceededError');
            return set.call(this, key, value);
          };
        });
        await editRest(probe, 'Rest pending');
        await probe.getByTestId('save-state').filter({ hasText: 'НЕ сохранено' }).waitFor();
        const exported = await memoryRest(probe);
        checkExtra(exported, extra);
        assert(exported.notes[0].title === 'Rest pending', 'export used stale storage');
        await probe.evaluate(() => window.restoreRestWrites());
        await probe.getByRole('button', { name: 'Повторить', exact: true }).click();
        await savedRest(probe, 'rest-one', 'Rest pending');
        checkExtra(await rawRest(probe, 'rest-one'), extra);
        await probe.reload({ waitUntil: 'networkidle' });
        await openRest(probe, 'Rest pending');
        await editRest(probe, 'Rest after reload');
        await savedRest(probe, 'rest-one', 'Rest after reload');
        checkExtra(await rawRest(probe, 'rest-one'), extra);
      } finally { await isolated.close(); }
    });
    await check('rest stays isolated across profile switches, switch flush and new profile creation', async () => {
      const otherExtra = { otherExtension: { owner: 'two' } };
      // W13: no known last profile, so startup still goes through the picker.
      const seed = seedProfiles({ profiles: [{ id: 'rest-one', name: 'One', created: 1 }, { id: 'rest-two', name: 'Two', created: 2 }], activeId: '', stores: { 'rest-one': restStore('One note', extra), 'rest-two': restStore('Two note', otherExtra) } });
      const isolated = await browser.newContext({ storageState: storageStateFor(seed) });
      try {
        const probe = await isolated.newPage(); attachErrorGuards(probe);
        await probe.goto(URL, { waitUntil: 'networkidle' });
        await enterRest(probe, 'rest-one');
        await openRest(probe, 'One note'); await editRest(probe, 'One switched');
        await pickerRest(probe); await enterRest(probe, 'rest-two');
        checkExtra(await rawRest(probe, 'rest-one'), extra);
        await openRest(probe, 'Two note'); await editRest(probe, 'Two edited');
        await savedRest(probe, 'rest-two', 'Two edited');
        checkExtra(await rawRest(probe, 'rest-two'), otherExtra);
        await pickerRest(probe); await enterRest(probe, 'rest-one');
        await openRest(probe, 'One switched'); await editRest(probe, 'One again');
        await savedRest(probe, 'rest-one', 'One again'); checkExtra(await rawRest(probe, 'rest-one'), extra);
        await pickerRest(probe);
        await probe.getByTestId('profile-name-in').fill('Clean'); await probe.getByTestId('profile-name-in').press('Enter');
        await newViaPalette(probe); await editRest(probe, 'New clean note');
        const id = await probe.evaluate(() => JSON.parse(localStorage.getItem('grafnot-profiles-v1')).activeId);
        await savedRest(probe, id, 'New clean note'); checkExtra(await rawRest(probe, id), {});
      } finally { await isolated.close(); }
    });
    await check('rest follows accepted and overwritten conflict versions and quiet cross-tab reloads', async () => {
      const isolated = await browser.newContext({ storageState: storageStateFor(oneSeed()) });
      try {
        const probe = await isolated.newPage(); attachErrorGuards(probe);
        await probe.goto(URL, { waitUntil: 'networkidle' }); await openRest(probe, 'Rest original');
        const other = await isolated.newPage(); attachErrorGuards(other);
        await other.goto(URL, { waitUntil: 'networkidle' }); await probe.bringToFront();
        const touch = (title, extras) => other.evaluate(({ title, extras }) => {
          const raw = JSON.parse(localStorage.getItem('grafnot-store-rest-one'));
          raw.notes[0].title = title;
          delete raw.extensionData; delete raw.emptyExtension; delete raw.otherExtension;
          Object.assign(raw, extras); localStorage.setItem('grafnot-store-rest-one', JSON.stringify(raw));
        }, { title, extras });
        const accepted = { extensionData: { owner: 'remote accepted' }, otherExtension: [9] };
        await editRest(probe, 'Mine discarded'); await touch('Remote accepted', accepted);
        await probe.getByTestId('save-state').filter({ hasText: 'Конфликт' }).waitFor();
        await probe.getByRole('button', { name: 'Принять чужую версию', exact: true }).click();
        await probe.getByRole('button', { name: 'Всё равно перейти', exact: true }).click();
        await openRest(probe, 'Remote accepted'); await editRest(probe, 'Accepted then edited');
        await savedRest(probe, 'rest-one', 'Accepted then edited'); checkExtra(await rawRest(probe, 'rest-one'), accepted);
        await editRest(probe, 'Mine retained'); await touch('Remote overwritten', { otherExtension: 'foreign' });
        await probe.getByTestId('save-state').filter({ hasText: 'Конфликт' }).waitFor();
        checkExtra(await memoryRest(probe), accepted);
        await probe.getByRole('button', { name: 'Перезаписать моей', exact: true }).click();
        await probe.getByRole('button', { name: 'Всё равно перейти', exact: true }).click();
        await savedRest(probe, 'rest-one', 'Mine retained'); checkExtra(await rawRest(probe, 'rest-one'), accepted);
        const quiet = { extensionData: { owner: 'quiet remote' }, emptyExtension: false };
        await touch('Quiet remote', quiet); await openRest(probe, 'Quiet remote');
        await editRest(probe, 'After quiet reload'); await savedRest(probe, 'rest-one', 'After quiet reload');
        checkExtra(await rawRest(probe, 'rest-one'), quiet);
      } finally { await isolated.close(); }
    });
  }
};
