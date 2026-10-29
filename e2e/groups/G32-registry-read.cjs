// E2E group G32-registry-read (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, seedLegacy, v5store, seedNote, groupActive, storageStateFor, check, assert, browser } = t;

  // ---------- GROUP G32-registry-read: unreadable does not mean first launch ----------
  if (await groupActive('G32-registry-read')) {
    const existing = () => seedProfiles({ profiles: [{ id: 'read-one', name: 'Original One', created: 1 }, { id: 'read-two', name: 'Original Two', created: 2 }], activeId: 'read-two', stores: { 'read-one': v5store([seedNote('read-a', 'Original note A')], 'read-a'), 'read-two': v5store([seedNote('read-b', 'Original note B')], 'read-b') } });
    await check('F2 transient registry read failure preserves every profile and retries in RU EN KZ', async () => {
      for (const [lang, title] of [['RU', 'Не удалось прочитать список профилей'], ['EN', 'Could not read the profile list'], ['KZ', 'Профильдер тізімін оқу мүмкін болмады']]) {
        const seed = existing(); seed['grafnot-lang'] = lang;
        seed['grafnot-profiles-v1'] = JSON.stringify(JSON.parse(seed['grafnot-profiles-v1']), null, 2);
        const isolated = await browser.newContext({ storageState: storageStateFor(seed) });
        try {
          await isolated.addInitScript(() => {
            const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
            window.registryWrites = 0; window.profileWrites = 0;
            Storage.prototype.getItem = function (key) {
              if (key === 'grafnot-profiles-v1' && !sessionStorage.getItem('registry-read-failed-once')) {
                sessionStorage.setItem('registry-read-failed-once', '1'); throw new DOMException('Temporary registry read failure', 'SecurityError');
              }
              return get.call(this, key);
            };
            Storage.prototype.setItem = function (key, value) {
              if (key === 'grafnot-profiles-v1') window.registryWrites++;
              if (key.startsWith('grafnot-store-')) window.profileWrites++;
              return set.call(this, key, value);
            };
          });
          const probe = await isolated.newPage(); attachErrorGuards(probe);
          await probe.goto(URL, { waitUntil: 'networkidle' });
          await probe.getByTestId('registry-blocked').getByText(title, { exact: true }).waitFor();
          assert(await probe.getByTestId('quickadd').isDisabled(), 'creation allowed after failed registry read');
          const held = await probe.evaluate(() => ({ reg: localStorage.getItem('grafnot-profiles-v1'), one: localStorage.getItem('grafnot-store-read-one'), two: localStorage.getItem('grafnot-store-read-two'), registryWrites: window.registryWrites, profileWrites: window.profileWrites, pending: localStorage.getItem('grafnot-adoption-pending-v1') }));
          assert(held.reg === seed['grafnot-profiles-v1'] && held.one === seed['grafnot-store-read-one'] && held.two === seed['grafnot-store-read-two'], 'original registry or data changed during read failure');
          assert(held.registryWrites === 0 && held.profileWrites === 0 && held.pending === null, 'startup wrote data or began migration after failed registry read');
          await probe.getByTestId('registry-retry').click();
          // W13: once readable, the healthy registry reopens its last profile (read-two).
          await probe.getByTestId('note-item').filter({ hasText: 'Original note B' }).waitFor();
          assert(await probe.evaluate(() => localStorage.getItem('grafnot-profiles-v1')) === seed['grafnot-profiles-v1'], 'retry rewrote the original registry');
        } finally { await isolated.close(); }
      }
    });
    await check('F2 persistent registry read failure blocks repeated startup and legacy adoption until access returns', async () => {
      for (const seed of [existing(), seedLegacy(v5store([seedNote('old-read', 'Legacy after retry')], 'old-read'))]) {
        const isolated = await browser.newContext({ storageState: storageStateFor(seed) });
        try {
          await isolated.addInitScript(() => {
            const get = Storage.prototype.getItem;
            window.originalRegistryGet = key => get.call(localStorage, key);
            Storage.prototype.getItem = function (key) {
              if (key === 'grafnot-profiles-v1' && !sessionStorage.getItem('allow-registry-read')) throw new DOMException('Registry unavailable', 'SecurityError');
              return get.call(this, key);
            };
          });
          const probe = await isolated.newPage(); attachErrorGuards(probe);
          await probe.goto(URL, { waitUntil: 'networkidle' });
          for (let attempt = 0; attempt < 3; attempt++) {
            await probe.getByTestId('registry-blocked').waitFor();
            const snapshot = await probe.evaluate(() => ({ reg: window.originalRegistryGet('grafnot-profiles-v1'), stores: Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('grafnot-store-')).map(k => [k, localStorage.getItem(k)])), pending: localStorage.getItem('grafnot-adoption-pending-v1') }));
            assert(snapshot.reg === (seed['grafnot-profiles-v1'] || null), 'registry changed while unreadable');
            const expectedStores = Object.entries(seed).filter(([key]) => key.startsWith('grafnot-store-'));
            assert(Object.keys(snapshot.stores).length === expectedStores.length && expectedStores.every(([key, value]) => snapshot.stores[key] === value), 'copies or modified stores appeared while registry unreadable');
            assert(snapshot.pending === null, 'migration started without reading the registry');
            await probe.getByTestId('registry-retry').click();
          }
          await probe.evaluate(() => sessionStorage.setItem('allow-registry-read', '1'));
          await probe.getByTestId('registry-retry').click();
          if (seed['grafnot-profiles-v1']) { await probe.getByTestId('note-item').filter({ hasText: 'Original note B' }).waitFor(); }
          else { await probe.getByTestId('note-item').filter({ hasText: 'Legacy after retry' }).waitFor(); }
        } finally { await isolated.close(); }
      }
    });
  }
};
