// E2E group G17-adoption (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, attachErrorGuards, seedProfiles, seedLegacy, v5store, seedNote, reseed, groupActive, storageStateFor, check, assert, page, browser } = t;

  // ---------- GROUP G17-adoption: legacy adoption never loses data silently (STAGE 09) ----------
  // Quota stub: init script below, armed only by a 'grafnot-quota-stub' seed
  // flag. Profile-store and registry writes throw a real QuotaExceededError;
  // the legacy original and the flag stay writable.
  if (await groupActive('G17-adoption')) {
    const backToPicker = async () => {
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    };
    const adoptionState = () => page.evaluate(() => ({
      reg: window.localStorage.getItem('grafnot-profiles-v1'),
      legacy: window.localStorage.getItem('grafnot-store-v2'),
      stores: Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).sort(),
    }));
    await check('registry-only write failure blocks legacy, empty and recovered boots; retry commits safely', async () => {
      const legacyRaw = JSON.stringify(v5store([seedNote('reg-old', 'Registry legacy')], 'reg-old'));
      const recoveredRaw = JSON.stringify(v5store([seedNote('reg-recovered', 'Registry recovered')], 'reg-recovered'));
      const cases = [
        { seed: Object.assign(seedLegacy(JSON.parse(legacyRaw)), { 'grafnot-theme': 'dark' }), legacy: legacyRaw, title: 'Registry legacy' },
        { seed: { 'grafnot-theme': 'dark' }, legacy: null, title: null },
        { seed: { 'grafnot-profiles-v1': '{broken', 'grafnot-store-existing': recoveredRaw }, legacy: null, title: 'Registry recovered' },
      ];
      for (const scenario of cases) {
        const isolated = await browser.newContext({ storageState: storageStateFor(scenario.seed) });
        try {
          await isolated.addInitScript(() => {
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
              if (key === 'grafnot-profiles-v1' && sessionStorage.getItem('allow-registry') !== '1') {
                throw new DOMException('Registry quota', 'QuotaExceededError');
              }
              return set.call(this, key, value);
            };
          });
          const probe = await isolated.newPage();
          attachErrorGuards(probe);
          await probe.goto(URL, { waitUntil: 'networkidle' });
          await probe.getByTestId('registry-blocked').waitFor();
          assert(await probe.getByTestId('quickadd').isDisabled(), 'creation enabled without a saved registry');
          const storesBefore = await probe.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('grafnot-store-')).sort());
          assert(await probe.evaluate(() => localStorage.getItem('grafnot-store-v2')) === scenario.legacy, 'legacy removed on registry failure');
          if (scenario.seed['grafnot-theme']) assert(await probe.evaluate(() => localStorage.getItem('grafnot-theme')) === 'dark', 'bare prefs removed on registry failure');
          await probe.reload({ waitUntil: 'networkidle' });
          await probe.getByTestId('registry-blocked').waitFor();
          assert(JSON.stringify(await probe.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('grafnot-store-')).sort())) === JSON.stringify(storesBefore), 'retry created duplicate stores');
          await probe.evaluate(() => sessionStorage.setItem('allow-registry', '1'));
          await probe.getByTestId('registry-retry').click();
          await probe.getByTestId('registry-blocked').waitFor({ state: 'detached' });
          await probe.waitForLoadState('networkidle');
          assert(await probe.getByTestId('quickadd').isEnabled(), 'creation still blocked after registry commit');
          if (scenario.title) await probe.getByTestId('note-item').filter({ hasText: scenario.title }).waitFor();
          const final = await probe.evaluate(() => {
            const reg = JSON.parse(localStorage.getItem('grafnot-profiles-v1'));
            return { count: reg.profiles.length, legacy: localStorage.getItem('grafnot-store-v2'), theme: localStorage.getItem('grafnot-theme:' + reg.activeId), recovered: localStorage.getItem('grafnot-store-existing'), pending: localStorage.getItem('grafnot-adoption-pending-v1') };
          });
          assert(final.count === 1 && final.legacy === null, 'registry or legacy cleanup incorrect');
          if (scenario.seed['grafnot-theme']) assert(final.theme === 'dark', 'preferences not migrated after registry commit');
          if (scenario.title === 'Registry recovered') assert(final.recovered === recoveredRaw, 'recovery changed original store');
          assert(final.pending === null, 'migration marker left after success');
        } finally {
          await isolated.close();
        }
      }
    });
    await check('P34 adoption quota fails loud, keeps legacy, grows nothing', async () => {
      const big = 'x'.repeat(20000);
      await reseed(page, Object.assign(
        seedLegacy({ notes: [seedNote('o1', 'Old-big', { text: big })], tasks: [], activeId: 'o1' }),
        { 'grafnot-quota-stub': '1' },
      ));
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      assert((await page.locator('[data-testid="adoption-blocked"]').innerText()).includes('перенести'), 'wrong screen');
      let st = await adoptionState();
      assert(st.reg === null, 'registry saved despite quota');
      assert(st.legacy !== null && st.legacy.includes('Old-big'), 'legacy damaged');
      assert(st.stores.join(',') === 'grafnot-store-v2', 'keys grew: ' + st.stores.join(','));
      // Reload: still blocked, still no registry, key count stable.
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      st = await adoptionState();
      assert(st.reg === null && st.stores.join(',') === 'grafnot-store-v2', 'reload created keys: ' + JSON.stringify(st));
      // Start-empty cannot save the registry either: loud toast, stay blocked.
      await page.getByRole('button', { name: 'Начать с пустого профиля' }).click();
      await page.getByRole('button', { name: 'Точно? Начать с пустого' }).click();
      await page.locator('.g-toasts', { hasText: 'реестр' }).waitFor({ timeout: 8000 });
      st = await adoptionState();
      assert(st.reg === null, 'phantom registry saved');
      assert((await page.locator('[data-testid="adoption-blocked"]').count()) === 1, 'left blocked screen');
    });
    await check('P35 corrupt legacy waits for choice, start-empty keeps it', async () => {
      await reseed(page, seedLegacy('{oops'));
      await page.locator('[data-testid="adoption-blocked"]').waitFor();
      assert((await page.locator('[data-testid="adoption-blocked"]').innerText()).includes('не читаются'), 'wrong screen');
      assert((await page.getByRole('button', { name: 'Повторить' }).count()) === 0, 'retry on unreadable data');
      let st = await adoptionState();
      assert(st.reg === null && st.legacy === '{oops', 'state moved: ' + JSON.stringify(st));
      await page.getByRole('button', { name: 'Начать с пустого профиля' }).click();
      await page.getByRole('button', { name: 'Точно? Начать с пустого' }).click();
      await page.locator('.g-empty-t').waitFor();
      // Registry only on explicit choice; the legacy original stays.
      st = await adoptionState();
      assert(st.reg !== null && st.legacy === '{oops', 'legacy eaten: ' + JSON.stringify(st));
      // Picker re-offers the stranded legacy instead of stranding it.
      await backToPicker();
      await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).waitFor();
      // Import of still-unreadable data fails loud, registry untouched.
      await page.getByRole('button', { name: 'Импортировать как профиль' }).click();
      await page.getByRole('button', { name: 'Точно? Импортировать' }).click();
      await page.locator('.g-toasts', { hasText: 'операцию' }).waitFor({ timeout: 8000 });
      st = await adoptionState();
      assert(JSON.parse(st.reg).profiles.length === 1 && st.legacy === '{oops', 'import half-ran: ' + JSON.stringify(st));
    });
    await check('P36 valid legacy imports as a new verified profile', async () => {
      await reseed(page, Object.assign(
        seedProfiles({
          profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
          activeId: 'p1',
          stores: { p1: v5store([seedNote('e1', 'Existing')], 'e1') },
        }),
        seedLegacy({ notes: [seedNote('l1', 'Legacy-note')], tasks: [], activeId: 'l1' }),
      ));
      await backToPicker();
      await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).waitFor();
      await page.getByRole('button', { name: 'Импортировать как профиль' }).click();
      await page.getByRole('button', { name: 'Точно? Импортировать' }).click();
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Legacy-note' }).waitFor();
      const st = await adoptionState();
      assert(st.legacy === null, 'legacy left behind');
      assert(JSON.parse(st.reg).profiles.length === 2, 'registry wrong: ' + st.reg);
      assert((await page.locator('.g-banner', { hasText: 'Найдены старые данные' }).count()) === 0, 'banner stuck');
    });
  }
};
