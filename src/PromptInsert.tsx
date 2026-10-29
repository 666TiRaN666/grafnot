import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import type { PromptSave } from './store';
import type { LlmTpl } from './data';
import { LLM_TEMPLATES } from './data';
import { buildTplEntries, fillBody, listSlots, promptPreview, imageInit } from './promptUtils';
import { requiredSlots } from './workbenchModel';
import { copyText } from './widgets';
import { useListNav } from './useListNav';

export interface PromptChoice { title: string; text: string; templateId?: string; params?: Record<string, string>; source?: PromptSave; kind?: PromptSave['kind']; model?: PromptSave['model']; tokens?: string[] }
export function PromptInsert({ lang, templates, saves, valid, onInsert, onClose, onDraft }: {
  lang: Lang; templates: LlmTpl[]; saves: PromptSave[]; valid: boolean; onInsert: (choice: PromptChoice, bind: boolean) => void; onClose: () => void;
  /** Current filled result, kept by the caller so an implicit close can offer a copy. */
  onDraft: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [bind, setBind] = useState(false);
  const [shown, setShown] = useState(50);
  const first = useRef<HTMLInputElement>(null);
  const pool = useMemo(() => [
    ...buildTplEntries(LLM_TEMPLATES, templates).map(e => ({ id: e.tpl.id, title: e.tpl.name, body: e.tpl.body, defaults: e.tpl.defaults, templateId: e.tpl.id, source: undefined as PromptSave | undefined, kind: e.kind, image: e.kind === 'image' ? imageInit(e.tpl) : undefined })),
    ...saves.map(p => ({ id: 'save-' + p.id, title: p.title, body: promptPreview(p, templates), defaults: {} as Record<string, string>, templateId: undefined, source: p, kind: p.kind, image: p.kind === 'image' ? { model: p.model, tokens: p.tokens } : undefined })),
  ], [templates, saves]);
  const hits = pool.filter(e => (e.title + ' ' + e.body).toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = pool.find(e => e.id === selected);
  const slots = chosen ? listSlots(chosen.body) : [];
  const text = chosen ? fillBody(chosen.body, { ...chosen.defaults, ...values }) : '';
  const missing = chosen ? requiredSlots(chosen).filter(s => !(values[s] ?? chosen.defaults[s] ?? '').trim()) : [];
  useEffect(() => { onDraft(text); }, [text, onDraft]);
  const pick = (i: number) => { const e = hits[i]; if (e) { setSelected(e.id); setValues({ ...e.defaults }); } };
  const nav = useListNav(Math.min(shown, hits.length), pick);
  return <aside role="dialog" aria-label={tr('insertPrompt', lang)} className="prompt-insert" data-testid="prompt-insert" onKeyDown={e => { if (e.key === "Escape" && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
    <div className="ctx-heading"><strong>{tr('insertPrompt', lang)}</strong><button type="button" className="g-modal-x" aria-label={tr('closeBtn', lang)} onClick={onClose}>×</button></div>
    {!valid && <p role="status" className="g-status-bad">{tr('promptInsertInvalid', lang)}</p>}
    <label className="prompt-field">{tr('search_ph', lang)}<input ref={first} autoFocus className="g-in" data-testid="prompt-insert-search" value={query} onKeyDown={nav.onKeyDown} onChange={e => { setQuery(e.target.value); setSelected(null); setShown(50); nav.reset(); }} /></label>
    <div className="prompt-insert-list">{hits.slice(0, shown).map((e, i) => <button type="button" key={e.id} className={'n-suggestitem' + (selected === e.id || nav.active === i ? ' active' : '')} data-testid="prompt-insert-choice" aria-pressed={selected === e.id} onClick={() => pick(i)}>{e.title}</button>)}</div>
    {shown < hits.length && <button type="button" className="g-btn sm" onClick={() => setShown(n => n + 50)}>{tr('tplShowMore', lang).replace('{n}', String(Math.min(50, hits.length - shown)))}</button>}
    {chosen && <>
      {slots.map((slot, i) => <label className="prompt-field" key={slot}>{slot}<textarea className="g-in" data-testid={'prompt-insert-field-' + i} value={values[slot] ?? chosen.defaults[slot] ?? ''} onChange={e => setValues(v => ({ ...v, [slot]: e.target.value }))} /></label>)}
      <label className="prompt-field">{tr('previewT', lang)}<pre className="prompt-insert-preview" data-testid="prompt-insert-preview">{text}</pre></label>
      <label className="g-undone"><input type="checkbox" checked={bind} onChange={e => setBind(e.target.checked)} />{tr('promptInsertBind', lang)}</label>
      {!!missing.length && <p className="muted small">{tr('promptInsertMissing', lang)}: {missing.join(', ')}</p>}
    </>}
    <div className="prompt-insert-actions">
      <button type="button" className="g-btn" onClick={onClose}>{tr('cancelBtn', lang)}</button>
      <button type="button" className="g-btn" disabled={!text} onClick={() => { void copyText(text); }}>{tr('copyBtn', lang)}</button>
      <button type="button" className="g-btn primary" data-testid="prompt-insert-submit" disabled={!valid || !chosen || !!missing.length} onClick={() => { if (chosen) onInsert({ title: chosen.title, text, templateId: chosen.templateId, params: { ...chosen.defaults, ...values }, source: chosen.source, kind: chosen.kind, model: chosen.image?.model, tokens: chosen.image?.tokens }, bind); }}>{tr('promptInsertAction', lang)}</button>
    </div>
  </aside>;
}
