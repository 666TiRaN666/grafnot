/** Editor side of [[Title]] links: highlight markers, Ctrl/Cmd+click opens. */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { WIKI_RE, wikiLinkAt } from './wikiText';

function decorate(doc: PMNode, hint: string): DecorationSet {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const m of node.text.matchAll(WIKI_RE())) {
      const start = pos + (m.index ?? 0);
      out.push(Decoration.inline(start, start + m[0].length, { class: 'n-wikilink', 'data-wikilink': (m[1] ?? '').trim(), title: hint }));
    }
  });
  return DecorationSet.create(doc, out);
}

export interface WikiLinkOptions {
  /** Ctrl/Cmd+click on a marker: open the note with that title. */
  onOpen: (title: string) => void;
  hint: () => string;
}

export const WikiLinks = Extension.create<WikiLinkOptions>({
  name: 'wikiLinks',
  addOptions() {
    return { onOpen: () => {}, hint: () => '' };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        props: {
          decorations: (state) => decorate(state.doc, opts.hint()),
          handleClick: (view, pos, event) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const $pos = view.state.doc.resolve(pos);
            const parent = $pos.parent;
            const title = wikiLinkAt(parent.textContent, $pos.parentOffset);
            if (!title) return false;
            opts.onOpen(title);
            return true;
          },
        },
      }),
    ];
  },
});
