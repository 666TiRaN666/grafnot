// E2E group G19-notes (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { seedProfiles, v5store, seedNote, beginGroup, check, assert, page } = t;

  // ---------- GROUP G19-notes: S3 master-detail, [[ links, selection/slash menus, undo delete ----------
  // Seeded text must live in tiptap `content` (the editor renders content,
  // never the plain-text mirror) for selection-based checks to see it.
  const docPara = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  await beginGroup('G19-notes', seedProfiles({
    profiles: [{ id: 'p1', name: 'Основной', created: 1 }],
    activeId: 'a1',
    stores: {
      p1: v5store([
        seedNote('a1', 'Alpha', { text: 'alpha body one two', content: docPara('alpha body one two'), updated: 2 }),
        seedNote('b1', 'Beta', { text: 'beta body three four', content: docPara('beta body three four'), updated: 1 }),
      ], 'a1'),
    },
  }));

  // Editor clicks must settle focus before keys: Playwright does not wait
  // for ProseMirror focus, and keys sent to a button/body vanish silently.
  // Worse, keys sent while a full-doc selection from an earlier check is
  // still active replace the whole document (P4: End lost + Enter wiped the
  // doc, then onUpdate persisted the loss). So focusEditor verifies a
  // COLLAPSED caret in a focus held across frames before any key is sent.
  async function focusEditor() {
    const settled = () => page.waitForFunction(() => {
      const ae = document.activeElement || {};
      if (!(ae.classList?.contains('ProseMirror')) || (window.getSelection()?.isCollapsed !== true)) return false;
      return new Promise((res) => setTimeout(() => {
        const now = document.activeElement || {};
        res(now === ae && (window.getSelection()?.isCollapsed === true));
      }, 120));
    }, null, { timeout: 8000 });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('.tiptap').click();
      try {
        await settled();
        if (attempt === 1) console.log('RETRY-USED focusEditor');
        return;
      } catch { /* single documented retry (P4.5): click missed the doc */ }
    }
    await page.locator('.tiptap').click();
    await settled();
  }
  // Synthetic key delivery flakes under load: a re-render between the click
  // and the keypress steals ProseMirror focus and the key lands on body.
  // Fix (P4): press only into settled focus (activeElement holds across 120ms),
  // then a single documented retry with a counter (P4.5 allowlist).
  async function selectAllInEditor() {
    // Selection is the menu's precondition: verify it exists before waiting
    // for the menu, otherwise a lost keypress looks like a product bug.
    for (let attempt = 0; attempt < 2; attempt++) {
      await focusEditor();
      await page.waitForFunction(() => {
        const el = document.activeElement;
        if (!(el || {}).classList?.contains('ProseMirror')) return false;
        return new Promise((res) => setTimeout(() => res(document.activeElement === el), 120));
      }, null, { timeout: 8000 });
      await page.keyboard.press('Control+a');
      try {
        await page.waitForFunction(() => (window.getSelection() || '').toString().length > 0, null, { timeout: 8000 });
        await page.getByTestId('sel-menu').waitFor({ timeout: 8000 });
        if (attempt === 1) console.log('RETRY-USED selectAllInEditor');
        return;
      } catch { /* single documented retry, see above */ }
    }
    await page.getByTestId('sel-menu').waitFor();
  }

  await check('S3 slash menu inserts heading', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.waitForFunction(() => (document.querySelector('.g-title-in') || {}).value === 'Beta', null, { timeout: 8000 });
    await focusEditor();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    try {
      await page.getByTestId('slash-menu').waitFor({ timeout: 5000 });
    } catch {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await page.getByTestId('slash-menu').waitFor();
    }
    await page.keyboard.press('Enter');
    assert((await page.locator('.tiptap h3').count()) >= 1, 'no heading inserted');
  });

  await check('S3 task from selection opens plan from toast', async () => {
    await selectAllInEditor();
    // P2: Ctrl+Alt+T by keys, not the button (Chrome intercepts the old combination).
    await page.keyboard.press('Control+Alt+t');
    // S4: filed at once, no dialog; the toast opens the planner.
    assert((await page.locator('.g-modal').count()) === 0, 'dialog opened');
    await page.locator('.g-toast-undo').waitFor();
    await page.locator('.g-toast-undo').click();
    assert((await page.evaluate(() => window.location.hash)).includes('#/plan'), 'toast did not open plan');
  });

  await check('S3 ctx tabs switch panels', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.locator('.g-title-in').waitFor();
    // P4: ctx panel mounts with the editor chunk; clicking tabs before that
    // settles loses the switch under suite load.
    await page.getByTestId('ctx-tabs').waitFor();
    for (const t of ['ctx-tab-links', 'ctx-tab-similar', 'ctx-tab-tasks', 'ctx-tab-prompts', 'ctx-tab-snip']) {
      assert((await page.getByTestId(t).count()) === 1, 'no ' + t);
    }
    await page.getByTestId('ctx-tab-tasks').click();
    await page.locator('.g-note-tasks', { hasText: '(1)' }).waitFor();
  });
};
