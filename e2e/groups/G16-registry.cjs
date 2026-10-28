// E2E group G16-registry (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, reseed, groupActive, check, assert, page } = t;

  // ---------- GROUP G16-registry: corrupt registry never loses stores (STAGE 08) ----------
  // An invalid element poisons the whole registry: boot backs it up, rebuilds
  // from store keys (generated names), and never adopts a random default over
  // the data. Both profiles stay enterable, notes intact.
  if (await groupActive('G16-registry')) {
    const regStores = () => ({
      f1: v5store([seedNote('a1', 'Note-A')], 'a1'),
      f2: v5store([seedNote('b1', 'Note-B')], 'b1'),
    });
    const storeKeys = () => page.evaluate(
      () => Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')).sort(),
    );
    const backToPicker = async () => {
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    };
    await check('P33 invalid entry recovers every profile from keys', async () => {
      await reseed(page, seedProfiles({
        profiles: [
          { id: 'f1', name: 'Основной', created: 1 },
          { id: 7, name: 'X' },
          { id: 'f2', name: 'Второй', created: 2 },
        ],
        activeId: 'f1',
        stores: regStores(),
      }));
      await page.locator('.g-toasts', { hasText: 'восстановлен' }).waitFor();
      await page.locator('[data-testid="profile-picker"]').waitFor();
      assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'not both recovered');
      const reg = await page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')));
      assert(reg.profiles.map((p) => p.id).join(',') === 'f1,f2', 'ids lost: ' + JSON.stringify(reg));
      assert((await storeKeys()).join(',') === 'grafnot-store-f1,grafnot-store-f2', 'extra keys adopted');
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 1' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Note-A' }).waitFor();
      await backToPicker();
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 2' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Note-B' }).waitFor();
    });
    await check('P33 broken registry recovers profiles and keeps a backup', async () => {
      await reseed(page, seedProfiles({ profiles: '{oops', activeId: '', stores: regStores() }));
      await page.locator('.g-toasts', { hasText: 'восстановлен' }).waitFor();
      await page.locator('[data-testid="profile-picker"]').waitFor();
      assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'not both recovered');
      const kept = await page.evaluate(() => {
        const bks = Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-profiles-v1:corrupt-'));
        return { n: bks.length, raw: bks.length > 0 ? window.localStorage.getItem(bks[0]) : null };
      });
      assert(kept.n === 1 && kept.raw === '{oops', 'backup missing: ' + JSON.stringify(kept));
      assert((await storeKeys()).join(',') === 'grafnot-store-f1,grafnot-store-f2', 'extra keys adopted');
      await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Профиль 2' }).getByRole('button', { name: 'Войти' }).click();
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Note-B' }).waitFor();
    });
  }
};
