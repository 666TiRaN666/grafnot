// E2E group G19-notes (run order: e2e/check6.cjs).
module.exports = async function (t) {
  const { openContext } = t;
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
    await openContext(page);
    for (const t of ['ctx-tab-links', 'ctx-tab-tasks', 'ctx-tab-prompts']) {
      assert((await page.getByTestId(t).count()) === 1, 'no ' + t);
    }
    await page.getByTestId('ctx-tab-tasks').click();
    await page.getByTestId('ctx-panel').getByRole('tabpanel').filter({ hasText: '(1)' }).waitFor();
  });

  await check('Notes: Ctrl/Shift selection, Ctrl+A, bulk trash with one Undo, Esc clears', async () => {
    await t.closeContext(page);
    await page.getByTestId('nav-notes').click();
    const items = page.getByTestId('note-item');
    await items.first().waitFor();
    const n = await items.count();
    await items.first().click();
    await page.waitForFunction(() => /^#\/notes\/./.test(location.hash));
    const hash = await page.evaluate(() => location.hash);
    await items.nth(1).click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('notes-sel-bar').waitFor();
    assert((await page.evaluate(() => location.hash)) === hash, 'Ctrl+click opened a note');
    const checked = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="note-check"]')].filter((c) => c.checked).length);
    assert((await checked()) === 2, 'open note did not join the selection');
    await items.first().focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.waitForFunction((k) => [...document.querySelectorAll('[data-testid="note-check"]')].filter((c) => c.checked).length === k, n, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="notes-sel-bar"]'), null, { timeout: 5000 });
    await items.nth(0).click({ modifiers: ['ControlOrMeta'] });
    await items.nth(n - 1).click({ modifiers: ['Shift'] });
    assert((await checked()) === n, 'Shift+click range is not the whole list');
    await page.getByTestId('notes-sel-trash').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="note-item"]').length === 0, null, { timeout: 5000 });
    await page.locator('.g-toast', { hasText: String(n) }).locator('.g-toast-undo').click();
    await page.waitForFunction((k) => document.querySelectorAll('[data-testid="note-item"]').length === k, n, { timeout: 5000 });
    const store = await page.evaluate(() => JSON.parse(localStorage.getItem('grafnot-store-p1')));
    assert(store.trash.length === 0 && store.notes.length === n, 'Undo did not restore every note');
  });

  // Select from the start of block `a` (char offset) to block `b` in the editor, then wait for focus to hold.
  const selectBlocks = (a, b) => page.evaluate(([x, y]) => {
    const ed = document.querySelector('.tiptap');
    ed.focus();
    const blocks = [...ed.querySelectorAll(':scope > p')];
    const r = document.createRange();
    r.setStart(blocks[x].firstChild || blocks[x], 0);
    const last = blocks[y].firstChild || blocks[y];
    r.setEnd(last, (last.textContent || '').length);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, [a, b]);
  const tb = (id) => page.getByTestId(id).click();

  await check('Rich text: list buttons make the asked type from a selection, formatting and indent survive reload', async () => {
    await page.getByTestId('nav-notes').click();
    await page.locator('[data-testid="note-item"]', { hasText: 'Beta' }).click();
    await page.getByTestId('editor-toolbar').waitFor();
    // Start from three known paragraphs: earlier checks of the group edit this note.
    await focusEditor();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('first line');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('second line');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('third line');
    await page.waitForFunction(() => document.querySelectorAll('.tiptap > p').length === 3);
    await selectBlocks(0, 1);
    await tb('tb-ordered');
    await page.waitForFunction(() => document.querySelectorAll('.tiptap > ol > li').length === 2, null, { timeout: 5000 });
    assert((await page.locator('.tiptap ul').count()) === 0, 'numbered list button made a bulleted list');
    await tb('tb-task');
    await page.waitForFunction(() => document.querySelectorAll('.tiptap ul[data-type="taskList"] > li').length === 2, null, { timeout: 5000 });
    await tb('tb-bullet');
    await page.waitForFunction(() => document.querySelectorAll('.tiptap > ul:not([data-type]) > li').length === 2, null, { timeout: 5000 });
    await tb('tb-bullet');
    await page.waitForFunction(() => document.querySelectorAll('.tiptap > p').length === 3, null, { timeout: 5000 });
    // Bold + italic + highlight on a selection that stays selected between buttons.
    await selectBlocks(2, 2);
    await tb('tb-bold');
    await tb('tb-italic');
    assert((await page.evaluate(() => window.getSelection()?.toString())) === 'third line', 'toolbar lost the selection');
    await tb('tb-color');
    await tb('tb-mark-green');
    await tb('tb-color');
    await tb('tb-color-red');
    const applied = await page.evaluate(() => document.querySelector('.tiptap').innerHTML);
    assert(applied.includes('data-color="green"') && applied.includes('data-color="red"'), 'colour menu did not apply: ' + applied.slice(-260));
    // Tab on the empty line after it: an indent level, focus stays.
    await page.keyboard.press('End');
    // The caret moved by End must reach the editor state before Enter (Enter on a
    // stale selection replaced the line: the toolbar's late second focus wrote it back).
    await page.waitForFunction(() => document.querySelector('.tiptap')?.editor?.state.selection.empty === true, null, { timeout: 5000 }).catch(async () => {
      const d = await page.evaluate(() => { const e = document.querySelector('.tiptap')?.editor; const ds = getSelection(); return { active: (document.activeElement?.className || document.activeElement?.tagName || '').slice(0, 40), testid: document.activeElement?.getAttribute('data-testid'), hasFocus: document.hasFocus(), pm: e ? [e.state.selection.from, e.state.selection.to] : null, pmFocus: e?.view.hasFocus(), dom: ds?.toString(), anchor: ds?.anchorNode?.nodeName, html: document.querySelector('.tiptap')?.innerHTML.slice(-200), pages: 0 }; });
      throw new Error('DIAG ' + JSON.stringify({ ...d, pages: page.context().pages().length }));
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror')), 'Tab on an empty line left the text');
    await page.waitForFunction(() => [...document.querySelectorAll('.tiptap > p')].pop()?.getAttribute('data-indent') === '2', null, { timeout: 5000 });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'b1').content.content.some((b) => b.attrs?.indent === 2), null, { timeout: 8000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.tiptap mark[data-color="green"]').waitFor({ timeout: 8000 }).catch(async () => {
      const dump = await page.evaluate(() => ({ hash: location.hash, html: document.querySelector('.tiptap')?.innerHTML.slice(0, 300), stored: JSON.stringify(JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find((n) => n.id === 'b1').content).slice(0, 600) }));
      throw new Error('after reload: ' + JSON.stringify(dump));
    });
    const html = await page.evaluate(() => document.querySelector('.tiptap').innerHTML);
    assert(/<strong>|<em>/.test(html) && html.includes('data-color="red"') && html.includes('data-color="green"'), 'combined formatting lost on reload: ' + html.slice(0, 200));
    assert((await page.evaluate(() => [...document.querySelectorAll('.tiptap > p')].pop()?.getAttribute('data-indent'))) === '2', 'indent lost on reload');
  });

  await check('Menus: note ⋯ closes on outside click and Esc (aria-expanded, focus back); Insert table, Tab walks its cells', async () => {
    const more = page.getByTestId('notes-more');
    await more.click();
    await page.getByTestId('notes-menu').waitFor();
    assert((await more.getAttribute('aria-expanded')) === 'true', 'menu not marked open');
    await page.mouse.click(5, 5);
    await page.waitForFunction(() => !document.querySelector('[data-testid="notes-menu"]'), null, { timeout: 5000 });
    assert((await more.getAttribute('aria-expanded')) === 'false', 'aria-expanded stayed true');
    await more.click();
    await page.getByTestId('notes-menu').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="notes-menu"]') && document.activeElement?.getAttribute('data-testid') === 'notes-more', null, { timeout: 5000 });
    // Insert → Table: the caret lands in the first cell; Tab walks, a new row after the last.
    await focusEditor();
    await page.keyboard.press('Control+End');
    await page.getByTestId('insert-open').click();
    await page.getByTestId('insert-item-table').click();
    await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror') && !!window.getSelection()?.anchorNode?.parentElement?.closest('th'), null, { timeout: 5000 });
    await page.keyboard.insertText('Head');
    for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
    assert((await page.locator('.tiptap tr').count()) === 4, 'Tab after the last cell did not add a row');
    assert((await page.locator('.tiptap th').first().innerText()) === 'Head', 'typing missed the first cell');
  });

  await check('Data safety: a note with content this version cannot read stays read-only and unchanged', async () => {
    const before = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('grafnot-store-p1'));
      const n = st.notes.find((x) => x.id === 'a1');
      n.content = { type: 'doc', content: [{ type: 'futureWidget', attrs: { x: 1 } }, { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }] };
      n.text = 'kept';
      localStorage.setItem('grafnot-store-p1', JSON.stringify(st));
      return JSON.stringify(n.content);
    });
    await page.evaluate(() => { location.hash = '#/notes/a1'; });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('note-unsupported').waitFor();
    assert((await page.locator('.tiptap').getAttribute('contenteditable')) === 'false', 'unsupported note is editable');
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('grafnot-store-p1')).notes.find((x) => x.id === 'a1').content));
    assert(after === before, 'unsupported content was rewritten');
  });
};
