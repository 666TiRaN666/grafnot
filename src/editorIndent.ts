import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

type Dispatch = ((tr: Transaction) => void) | undefined;

/**
 * Notes written before the block indent (2026-11) may start with tab
 * characters. Shift+Tab still removes one leading tab per touched block, so
 * such text can be tidied with the same key; nothing converts it silently.
 */
export function outdentLegacyTabs(state: EditorState, dispatch: Dispatch): boolean {
  const lead: number[] = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.textContent.startsWith("\t")) lead.push(pos + 1);
    return false;
  });
  if (lead.length === 0) return false;
  if (dispatch) {
    const tr = state.tr;
    for (const p of lead.reverse()) tr.delete(p, p + 1);
    dispatch(tr);
  }
  return true;
}

export interface TabIndentOptions {
  /** Esc: leave the text (true = handled). Open inline menus answer false. */
  onEscape: () => boolean;
}

/**
 * One indent model for the note body (Word-like):
 * - a list item nests / un-nests (a task list too);
 * - a paragraph or heading changes its indent level (0–8), the same on an
 *   empty line and for every block of a selection — never a space or a tab
 *   character, so repeated presses keep working;
 * - a code block gets a tab character (code keeps literal indentation);
 * - a table walks its cells (the table extension, higher priority).
 * Tab is always handled in the text (no focus jump); Shift+Tab with nothing
 * to outdent keeps the reverse keyboard path to the title. Esc leaves the
 * text so Tab walks the interface again (no keyboard trap).
 */
export const TabIndent = Extension.create<TabIndentOptions>({
  name: "tabIndent",
  priority: 50,
  addOptions() {
    return { onEscape: () => false };
  },
  addKeyboardShortcuts() {
    const listItem = () => (this.editor.isActive("taskItem") ? "taskItem" : this.editor.isActive("listItem") ? "listItem" : null);
    return {
      Tab: ({ editor }) => {
        if (editor.isActive("codeBlock")) return editor.commands.insertContent("\t");
        const item = listItem();
        if (item) {
          editor.commands.sinkListItem(item);
          return true;
        }
        editor.commands.indent();
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const item = listItem();
        if (item && editor.commands.liftListItem(item)) return true;
        if (editor.commands.outdent()) return true;
        return outdentLegacyTabs(editor.state, editor.view.dispatch);
      },
      Escape: () => this.options.onEscape(),
    };
  },
});
