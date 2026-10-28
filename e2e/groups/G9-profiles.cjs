// E2E group G9-profiles (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { resetStorage, beginGroup, check, assert, page } = t;

  // ---------- GROUP G9-profiles: avatar, shortcuts, toasts, profiles (empty start) ----------
  await beginGroup('G9-profiles', {});

    await check('P23 settings entry opens settings page', async () => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-page').waitFor();
    assert((await page.locator('.g-modal').count()) === 0, 'settings still modal');
    for (const nav of ['settings-nav-profiles', 'settings-nav-appearance', 'settings-nav-trash', 'settings-nav-keys', 'settings-nav-data']) {
      assert((await page.getByTestId(nav).count()) === 1, 'no ' + nav);
    }
    assert((await page.evaluate(() => window.location.hash)).includes('#/settings'), 'no settings hash');
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('settings-page').waitFor({ state: 'detached' });
    assert((await page.getByTestId('settings-page').count()) === 0, 'settings stuck');
  });

    await check('P25 toast manual close', async () => {
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('task-composer').click();
    const box = page.locator('.g-page input[aria-label="new task"]');
    await box.fill('First toast probe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    assert((await page.locator('.g-toast').count()) === 0, 'not closed manually');
    await box.fill('Second toast probe with a very long tail ' + 'x'.repeat(160));
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await box.fill('Third toast probe');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    assert((await page.locator('.g-toast').count()) === 2, 'stack broken');
    const t = await page.locator('.g-toast').first().innerText();
    assert(t.includes('Задача добавлена'), `wrong toast: ${t}`);
    assert((await page.locator('.g-taskline', { hasText: 'Second toast probe' }).count()) === 1, 'long text broken');
    await page.locator('.g-toast').first().locator('.g-toast-x').click();
    assert((await page.locator('.g-toast').count()) === 1, 'wrong one closed');
    await page.locator('.g-toast').waitFor({ state: 'detached' });
  });

  await check('P26 profiles isolate data and prefs', async () => {
    await resetStorage(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.g-empty-t').waitFor();
    assert((await page.locator('[data-testid="profile-picker"]').count()) === 0, 'no auto-enter');
    await page.locator('.g-empty button').click();
    await page.locator('.g-title-in').fill('ProfileA-note');
    await page.keyboard.press('Enter');
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 1, 'one row');
    await page.locator('[data-testid="profile-name-in"]').fill('Второй');
    await page.getByRole('button', { name: '+ Новый профиль' }).click();
    await page.locator('.g-empty-t').waitFor();
    await page.getByTestId('nav-notes').click();
    assert((await page.locator('.g-noterow').count()) === 0, 'second not empty');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('settings-page').getByRole('button', { name: 'Тёмная', exact: true }).click();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'dark', 'dark not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'EN', exact: true }).click();
    assert((await page.getByTestId('settings-page').innerText()).includes('Settings'), 'lang not applied');
    await page.getByTestId('settings-page').getByRole('button', { name: 'RU', exact: true }).click();
    await page.getByTestId('nav-notes').click();
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg').count()) === 2, 'two rows');
    await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Основной' }).getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'ProfileA-note' }).waitFor();
    assert((await page.locator('.g-app').getAttribute('data-theme')) === 'light', 'theme leaked');
  });

  await check('P26b delete profile wipes its data', async () => {
    const victim = await page.evaluate(() => JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')).profiles.find((p) => p.name === 'Второй').id);
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: 'Сменить профиль' }).click();
    await page.locator('.g-modal').getByRole('button', { name: 'Сменить профиль', exact: true }).click();
    await page.locator('[data-testid="profile-picker"]').waitFor();
    const row = page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Второй' });
    await row.getByRole('button', { name: 'Удалить навсегда' }).click();
    await row.getByRole('button', { name: 'Точно? Удалить навсегда' }).click();
    await row.waitFor({ state: 'detached' });
    assert((await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Второй' }).count()) === 0, 'row left');
    const left = await page.evaluate((id) => ({
      stores: Object.keys(window.localStorage).filter((k) => k.startsWith('grafnot-store-')),
      stray: Object.keys(window.localStorage).filter((k) => k.includes(id)),
      reg: JSON.parse(window.localStorage.getItem('grafnot-profiles-v1')).profiles.length,
    }), victim);
    assert(left.stores.length === 1 && left.stray.length === 0 && left.reg === 1, `data left: ${JSON.stringify(left)}`);
    await page.locator('[data-testid="profile-picker"] .g-sugg', { hasText: 'Основной' }).getByRole('button', { name: 'Войти' }).click();
    await page.getByTestId('nav-notes').click();
    await page.locator('.g-noterow', { hasText: 'ProfileA-note' }).waitFor();
  });
};
