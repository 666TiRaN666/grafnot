// E2E group G36-skills (run order: e2e/check6.cjs).
// Skill builder: one spec rendered live as SKILL.md, a system prompt or
// AGENTS.md; built-in skills are worked examples saved as the user's copy.
module.exports = async function (t) {
  const { seedProfiles, v5store, beginGroup, groupActive, check, assert, page } = t;

  await beginGroup('G36-skills', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'p1',
    stores: { p1: v5store([], 'p1') },
  }));
  if (!(await groupActive('G36-skills'))) return;
  const preview = () => page.getByTestId('skill-preview').innerText();

  await check('Skill builder renders SKILL.md live, guards the name and saves to the library', async () => {
    await page.getByTestId('nav-prompt').click();
    await page.getByTestId('prompt-new').click();
    await page.getByTestId('prompt-new-skill').click();
    await page.getByTestId('skill-builder').waitFor();
    await page.getByTestId('skill-name').fill('My Skill');
    assert(await page.getByTestId('skill-save').isDisabled(), 'an invalid skill name can be saved');
    assert((await page.getByTestId('skill-lint').innerText()).includes('латиница'), 'name error not explained');
    await page.getByTestId('skill-slug').click();
    assert(await page.getByTestId('skill-name').inputValue() === 'my-skill', 'slug fix wrong');
    await page.getByTestId('skill-desc').fill('Explains code');
    await page.getByTestId('skill-when').fill('the user asks why code works');
    await page.getByTestId('skill-steps').fill('Read the code\n- Explain line by line');
    const md = await preview();
    assert(md.startsWith('---\nname: my-skill\ndescription: Explains code. Используй, когда the user asks why code works.\n---'), 'frontmatter wrong: ' + md.slice(0, 160));
    assert(md.includes('1. Read the code') && md.includes('2. Explain line by line'), 'steps not numbered: ' + md);
    await page.getByTestId('skill-format-system').click();
    assert(!(await preview()).startsWith('---'), 'system prompt kept frontmatter');
    await page.getByTestId('skill-format-skill').click();
    await page.getByTestId('skill-save').click();
    await page.locator('[data-testid="prompt-item"]', { hasText: 'my-skill' }).first().waitFor();
    // The store write is debounced: wait for it before reading.
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).customTpls.some((x) => x.name === 'my-skill'), null, { timeout: 8000 });
    const tpl = await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).customTpls.find((x) => x.name === 'my-skill'));
    assert(tpl && tpl.kind === 'skill' && tpl.skill.whenToUse === 'the user asks why code works' && tpl.body.startsWith('---'), 'skill not stored: ' + JSON.stringify(tpl).slice(0, 200));
  });

  await check('Built-in skill opens as an example, downloads SKILL.md and saves as a copy', async () => {
    await page.getByTestId('prompt-library').getByRole('button', { name: 'Навыки', exact: true }).click();
    const rows = page.locator('[data-testid="prompt-item"]');
    await rows.first().waitFor();
    assert(await rows.count() === 4, 'skills filter shows ' + (await rows.count()));
    await rows.filter({ hasText: 'Навык: ревью кода' }).click();
    await page.getByTestId('skill-builder').waitFor();
    assert((await page.getByTestId('skill-save').innerText()).includes('Сохранить копию'), 'built-in would be overwritten');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('skill-download').click()]);
    assert(dl.suggestedFilename() === 'SKILL.md', 'file name ' + dl.suggestedFilename());
    const text = require('fs').readFileSync(await dl.path(), 'utf8');
    assert(text.includes('name: code-review') && text.includes('## Порядок действий'), 'download content wrong');
    await page.getByTestId('skill-save').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).customTpls.some((x) => x.kind === 'skill' && x.name === 'code-review'), null, { timeout: 8000 });
  });
};
