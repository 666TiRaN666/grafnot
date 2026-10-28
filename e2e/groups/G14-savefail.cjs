// E2E group G14-savefail (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, reseed, groupActive, check, assert, page } = t;

  // ---------- GROUP G14-savefail: honest save status (STAGE 06) ----------
  if (await groupActive('G14-savefail')) {
    const failSeed = () => seedProfiles({
      profiles: [{ id: 'f1', name: 'Основной', created: 1 }],
      activeId: 'f1',
      stores: { f1: v5store([seedNote('n1', 'Fail me', { text: 'x' })], 'n1') },
    });
    const openFailNote = async () => {
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Fail me' }).first().locator('.g-noteopen').click();
      await page.locator('.g-title-in').waitFor();
    };
    const stubQuota = () => page.evaluate(() => {
      const orig = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = (k, v) => {
        if (String(k).startsWith('grafnot-store-')) throw new Error('quota');
        return orig(k, v);
      };
    });
    const failOneEdit = async (title) => {
      await page.locator('.g-title-in').fill(title);
      await page.locator('.g-title-in').press('Enter');
      await page.locator('.g-banner[role="alert"]', { hasText: 'НЕ сохранено' }).waitFor({ timeout: 8000 });
    };
    await check('P31 failed save shows banner and retries', async () => {
      await reseed(page, failSeed());
      await openFailNote();
      await stubQuota();
      await failOneEdit('Fail me edited');
      assert((await page.locator('.g-status').innerText()).includes('НЕ сохранено'), 'header lies');
      await page.evaluate(() => {
        delete window.localStorage.setItem;
      });
      await page.getByRole('button', { name: 'Повторить', exact: true }).click();
      await page.locator('.g-banner[role="alert"]').waitFor({ state: 'detached', timeout: 8000 });
      const st = await page.locator('.g-status').innerText();
      assert(!st.includes('НЕ сохранено'), 'still failed');
      const raw = await page.evaluate(() => window.localStorage.getItem('grafnot-store-f1'));
      assert((raw || '').includes('Fail me edited'), 'edit lost');
    });
    await check('P31 blocked switch keeps profile', async () => {
      await reseed(page, failSeed());
      await openFailNote();
      await stubQuota();
      await failOneEdit('Fail me edited');
      await page.getByTestId('nav-settings').click();
      await page.getByTestId('settings-page').waitFor();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      assert((await page.locator('[data-testid="profile-picker"]').count()) === 0, 'switched despite failure');
      assert((await page.locator('.g-banner[role="alert"]').count()) > 0, 'no failed banner');
      await page.keyboard.press('Escape');
      await page.getByTestId('nav-notes').click();
      await page.locator('.g-noterow', { hasText: 'Fail me' }).first().locator('.g-noteopen').click();
      assert((await page.locator('.g-title-in').inputValue()).includes('Fail me edited'), 'left the profile');
      await page.getByTestId('nav-settings').click();
      await page.getByRole('button', { name: 'Сменить профиль' }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
      await page.locator('.g-modal').getByRole('button', { name: 'Всё равно перейти', exact: true }).click();
      await page.locator('[data-testid="profile-picker"]').waitFor();
    });
  }
};
