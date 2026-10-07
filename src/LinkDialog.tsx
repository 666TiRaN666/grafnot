import { useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { Note } from './store';
import { PREVIEW_LEN } from './promptUtils';
import { Modal } from './widgets';

export function matchLinkCandidate(n: Pick<Note, "id" | "title"> & { text?: string }, excludeId: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return n.id !== excludeId && `${n.title} ${n.text ?? ""}`.toLowerCase().includes(needle);
}

export function LinkDialog({
  lang,
  source,
  notes,
  linkedIds,
  excludeId,
  initialQuery,
  onConfirm,
  onClose,
}: {
  lang: Lang;
  source: string;
  notes: Note[];
  linkedIds: string[];
  excludeId: string;
  initialQuery: string;
  onConfirm: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(initialQuery);
  const [sel, setSel] = useState('');
  const [shown, setShown] = useState(8);
  const all = notes.filter((n) => matchLinkCandidate(n, excludeId, q));
  // Default slice stays 8, but the cut is never silent: honest counter plus
  // a pager into the rest.
  const cands = all.slice(0, shown);
  const target = notes.find((n) => n.id === sel);

  return (
    <Modal title={tr('linkTitle', lang)} lang={lang} onClose={onClose}>
      <div className="g-linkrow">
        <div>
          <div className="muted small">{tr('linkFrom', lang)}</div>
          <div className="g-chip sm static">{source || '—'}</div>
        </div>
        <div className="g-linkarrow">↔</div>
        <div>
          <div className="muted small">{tr('linkTo', lang)}</div>
          <div className="g-chip sm static">{target ? target.title : '…'}</div>
        </div>
      </div>
      <input
        className="g-in"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setShown(8);
        }}
        placeholder={tr('linkSearchPh', lang)}
        aria-label="find note"
      />
      {all.length > 0 && (
        <div className="muted small" style={{ padding: '4px 12px 0' }}>
          {tr('listShownOf', lang).replace('{x}', String(cands.length)).replace('{y}', String(all.length))}
        </div>
      )}
      <div className="g-linklist">
        {cands.length === 0 && <div className="muted small" style={{ padding: 12 }}>{tr('linkEmpty', lang)}</div>}
        {cands.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`g-linkitem${sel === n.id ? ' sel' : ''}`}
            onClick={() => setSel(n.id)}
          >
            <span>{n.title || tr('newNoteTitle', lang)}</span>
            {linkedIds.includes(n.id) && <span className="g-ok">✓</span>}
          </button>
        ))}
        {shown < all.length && (
          <button type="button" className="g-btn sm g-tpl-more" onClick={() => setShown((s) => s + 8)}>
            {tr('tplShowMore', lang).replace('{n}', String(Math.min(8, all.length - shown)))}
          </button>
        )}
      </div>
      {target && <div className="g-linkprev">{target.text.slice(0, PREVIEW_LEN) || '—'}</div>}
      <div className="g-modal-actions">
        <button type="button" className="g-btn" onClick={onClose}>
          {tr('cancelBtn', lang)}
        </button>
        <button
          type="button"
          className="g-btn primary"
          disabled={!target}
          onClick={() => {
            if (target) onConfirm(target.id);
          }}
        >
          {target ? `${tr('linkConfirm', lang)} «${source}» ↔ «${target.title}»` : tr('linkConfirm', lang)}
        </button>
      </div>
    </Modal>
  );
}
