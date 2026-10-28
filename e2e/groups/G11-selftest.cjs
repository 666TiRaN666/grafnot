// E2E group G11-selftest (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { URL, beginGroup, openSecondTab, check, assert, page, ctx } = t;

  // ---------- GROUP G11-selftest: two tabs share one localStorage (STAGE 02.6) ----------
  await beginGroup('G11-selftest', {});
  await check('P28 second tab shares storage', async () => {
    const t2 = await openSecondTab(ctx);
    await t2.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.localStorage.setItem('grafnot-selftest-marker', 'tab1'));
    const seen = await t2.evaluate(() => window.localStorage.getItem('grafnot-selftest-marker'));
    assert(seen === 'tab1', 'second tab sees different storage');
    await t2.close();
    await page.evaluate(() => window.localStorage.removeItem('grafnot-selftest-marker'));
  });
};
