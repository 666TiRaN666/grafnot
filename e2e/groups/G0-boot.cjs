// E2E group G0-boot (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { beginGroup, check, assert, page } = t;

  // ---------- GROUP G0-boot: first run, empty storage ----------
  await beginGroup('G0-boot', {});
  // ---------- P5: empty start ----------
  await check('P5 empty home', async () => {
    await page.locator('.g-empty-t').waitFor();
    const t = await page.locator('.g-empty').innerText();
    assert(t.includes('Пока пусто'), 'no empty title');
  });
  await check('P5 empty search', async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette').waitFor();
    await page.getByTestId('palette-input').fill('zzz-no-such-thing');
    const t = await page.getByTestId('palette').innerText();
    assert(t.includes('Ничего не найдено'), 'search not empty');
    await page.keyboard.press('Escape');
  });
  await check('P5 first note + hint once', async () => {
    await page.locator('.g-empty button').click();
    await page.getByTestId('title-in').waitFor();
    assert((await page.getByTestId('title-in').inputValue()) === '', 'first note has an automatic title');
    assert(await page.getByTestId('editor').getByRole('textbox').evaluate(el => document.activeElement === el), 'first note body not focused');
    await page.locator('.g-hint').waitFor();
    await page.locator('.g-hint button').click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.g-title-in').waitFor();
    assert((await page.locator('.g-hint').count()) === 0, 'hint shown again');
  });
};
