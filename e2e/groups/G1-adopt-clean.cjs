// E2E group G1-adopt-clean (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedLegacy, beginGroup, check, assert, page } = t;

  // ---------- GROUP G1-adopt-clean: legacy adoption drops broken links ----------
  await beginGroup('G1-adopt-clean', seedLegacy({
    notes: [{ id: 'o1', title: 'Old', content: '', text: '', linked: ['Ghost'] }],
    tasks: [],
    activeId: 'o1',
  }));

  // ---------- P6: tiptap + cursor ----------

  await check('P5b migration drops broken links', async () => {
    await page.locator('.g-toasts').waitFor();
    assert((await page.locator('.g-toasts').innerText()).includes('Удалено битых ссылок'), 'no cleanup toast');
    await page.locator('.g-title-in').waitFor();
  });
};
