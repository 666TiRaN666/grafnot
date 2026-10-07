import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import { unlinkedNotes } from './store';
import type { Note } from './store';
import { Hi, Modal } from './widgets';
import { useListState } from "./useListState";

import { TPL_LIMITS } from "./listPrefs";
import { PREVIEW_LEN } from "./promptUtils";
import { useArmConfirm } from "./useArmConfirm";


const W = 800;
const H = 500;

/** Hit radius in SVG content units (matches the .g-vhit circle). */
const HIT_R = 24;

/** Nearest node center to a content-space point (stable fallback = canvas center). */
function nearestNode(nodes: { id: string }[], pos: Record<string, { x: number; y: number }>, x: number, y: number): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const n of nodes) {
    const c = pos[n.id] ?? { x: W / 2, y: H / 2 };
    const d = Math.hypot(x - c.x, y - c.y);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  return best;
}

import { layoutGraph, type GPos as Pos } from './graphLayout';

/** Deterministic force-directed layout (sync, no animation loop). */

function GraphCanvas({
  lang,
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  lang: Lang;
  nodes: Note[];
  edges: [string, string][];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ids = nodes.map((n) => n.id);
  const edgeKey = edges.map((e) => e.join('>')).join('|');
  const scopeKey = ids.join(',') + '#' + edgeKey;
  const [pos, setPos] = useState<Record<string, Pos>>({});
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<null | {
    mode: 'pan' | 'node';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  }>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const zoomRef = useRef(( _cx: number, _cy: number, _f: number) => {});

  // Canvas uses default preserveAspectRatio="xMidYMid meet": account for
  // letterboxing offsets, otherwise all pointer math drifts.
  const metrics = () => {
    const el = svgRef.current;
    if (!el) return { r: new DOMRect(), s: 1, ox: 0, oy: 0 };
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    return { r, s, ox: (r.width - W * s) / 2, oy: (r.height - H * s) / 2 };
  };

  const toContent = (clientX: number, clientY: number) => {
    const { r, s, ox, oy } = metrics();
    const v = viewRef.current;
    return {
      x: ((clientX - r.left - ox) / s - v.x) / v.k,
      y: ((clientY - r.top - oy) / s - v.y) / v.k,
    };
  };

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const { r, s, ox, oy } = metrics();
    const cx = (clientX - r.left - ox) / s;
    const cy = (clientY - r.top - oy) / s;
    setView((v) => {
      const k2 = Math.min(2.5, Math.max(0.4, v.k * factor));
      return { k: k2, x: cx - ((cx - v.x) * k2) / v.k, y: cy - ((cy - v.y) * k2) / v.k };
    });
  };
  zoomRef.current = zoomAt;

  const zoomStep = (factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const prevKey = useRef('');
  useEffect(() => {
    const fresh = layoutGraph(ids, edges);
    setPos((prev) => {
      const next: Record<string, Pos> = {};
      for (const id of ids) next[id] = prev[id] ?? fresh[id] ?? { x: W / 2, y: H / 2 };
      return next;
    });
    const [idsPart] = scopeKey.split('#');
    const [prevIds] = prevKey.current.split('#');
    if (idsPart !== prevIds) setView({ k: 1, x: 0, y: 0 });
    prevKey.current = scopeKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  // Single delegated pointer layer on the root: mode decided once at
  // pointerdown from the nearest node center in radius (not the topmost
  // circle: dense graphs overlap r24 zones, and the topmost target is not
  // necessarily the intended node). Capture stays on the stable root.
  const onPointerDown = (e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const p = toContent(e.clientX, e.clientY);
    const near = nearestNode(nodes, pos, p.x, p.y);
    const id = near && near.d <= HIT_R ? near.id : undefined;
    const v = viewRef.current;
    dragRef.current = {
      mode: id ? 'node' : 'pan',
      id,
      sx: e.clientX,
      sy: e.clientY,
      ox: v.x,
      oy: v.y,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // 4px threshold with hysteresis: once engaged, moved sticks even if the
    // pointer drifts back, so jitter never flips a drag back into a click.
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.mode === 'pan') {
      const { s } = metrics();
      const v = viewRef.current;
      // 1:1 tracking with the pointer on screen.
      setView({ ...v, x: d.ox + (e.clientX - d.sx) / s / v.k, y: d.oy + (e.clientY - d.sy) / s / v.k });
    } else if (d.id) {
      const p = toContent(e.clientX, e.clientY);
      const id = d.id;
      setPos((prev) => ({
        ...prev,
        [id]: { x: Math.min(W - 20, Math.max(20, p.x)), y: Math.min(H - 20, Math.max(20, p.y)) },
      }));
    }
  };

  const endDrag = (cancelled: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    // A cancelled gesture (touch interrupt, capture loss) is never a click;
    // a real click selects only when the pointer never left the 4px zone.
    if (!cancelled && d && !d.moved && d.mode === 'node' && d.id) onSelect(d.id);
  };

  const deg = new Map<string, number>();
  for (const [a, b] of edges) {
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  const linkedSet = new Set<string>();
  for (const [a, b] of edges) {
    linkedSet.add(a);
    linkedSet.add(b);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const short = (s: string) => (s.length > 14 ? s.slice(0, 13) + '…' : s || '—');

  return (
    <div>
      <div className="g-gtools">
        <button type="button" className="g-btn sm" title={tr('zoomInT', lang)} aria-label={tr('zoomInT', lang)} onClick={() => zoomStep(1.25)}>
          +
        </button>
        <button type="button" className="g-btn sm" title={tr('zoomOutT', lang)} aria-label={tr('zoomOutT', lang)} onClick={() => zoomStep(0.8)}>
          −
        </button>
        <button type="button" className="g-btn sm" title={tr('zoomResetT', lang)} onClick={() => setView({ k: 1, x: 0, y: 0 })}>
          {tr('zoomResetT', lang)}
        </button>
        <button type="button" className="g-btn sm" onClick={() => setPos(layoutGraph(ids, edges))}>
          {tr('relayout', lang)}
        </button>
      </div>
      <svg
        ref={svgRef}
        className="g-canvas"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        tabIndex={0}
        aria-label={tr('kmap', lang)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(false)}
        onPointerCancel={() => endDrag(true)}
      >
        <defs>
          <marker id="g-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="var(--faint)" />
          </marker>
        </defs>
        <g className="g-view" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map(([a, b]) => {
            const pa = pos[a];
            const pb = pos[b];
            if (!pa || !pb) return null;
            return <line key={`${a}>${b}`} className="g-vedge" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} markerEnd="url(#g-arr)" />;
          })}
          {nodes.map((n) => {
            const p = pos[n.id] ?? { x: W / 2, y: H / 2 };
            const r = 8 + Math.min(6, (deg.get(n.id) ?? 0) * 1.5);
            const sel = selectedId === n.id;
            const orph = !linkedSet.has(n.id);
            return (
              <g
                key={n.id}
                data-node={n.id}
                tabIndex={0}
                role="button"
                aria-label={byId.get(n.id)?.title || ''}
                onKeyDown={(ke) => {
                  if (ke.key === 'Enter' || ke.key === ' ') {
                    ke.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                <circle className="g-vhit" cx={p.x} cy={p.y} r={HIT_R} fill="transparent" />
                <circle
                  className={`g-vnode${sel ? ' sel' : ''}${orph ? ' orph' : ''}`}
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  data-id={n.id}
                />
                <text className="g-vlabel" x={p.x} y={p.y + r + 14}>
                  {short(byId.get(n.id)?.title ?? '')}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

export function MapPage({
  lang,
  notes,
  graphs,
  notify,
  onOpen,  onPurge,
  onCreateGraph,
  onRenameGraph,
  onDeleteGraph,
  onToggleMember,
  profileId,
}: {
  lang: Lang;
  notes: Note[];
  graphs: { id: string; title: string; noteIds: string[] }[];
  notify: (msg: string) => void;
  onOpen: (id: string) => void;
  onPurge: (title: string) => void;
  onCreateGraph: (title: string) => string;
  onRenameGraph: (id: string, title: string) => void;
  onDeleteGraph: (id: string) => void;
  onToggleMember: (noteId: string, graphId: string) => void;
  profileId: string;
}) {
  const [scope, setScope] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [ungShown, setUngShown] = useState(5);



  const [gDraft, setGDraft] = useState('');
  const delConfirm = useArmConfirm();

  const graph = graphs.find((g) => g.id === scope);
  const scopeNotes = graph ? notes.filter((n) => graph.noteIds.includes(n.id)) : notes;
  const ungrouped = notes.filter((n) => !graphs.some((g) => g.noteIds.includes(n.id)));
  const unlinked = unlinkedNotes(scopeNotes);

  const allIds = new Set(notes.map((n) => n.id));
  const brokenMap = new Map<string, number>();
  for (const n of scopeNotes) {
    for (const id of n.linkedIds) {
      if (id !== n.id && !allIds.has(id)) brokenMap.set(id, (brokenMap.get(id) ?? 0) + 1);
    }
  }
  const broken = [...brokenMap.entries()].map(([id, usedIn]) => ({ id, usedIn }));

  const inScope = new Set(scopeNotes.map((n) => n.id));
  const edgeSet = new Set<string>();
  const edges: [string, string][] = [];
  for (const n of scopeNotes) {
    for (const t of n.linkedIds) {
      if (t !== n.id && inScope.has(t)) {
        const k = [n.id, t].sort().join('>');
        if (!edgeSet.has(k)) {
          edgeSet.add(k);
          edges.push([n.id, t]);
        }
      }
    }
  }

  const selected = notes.find((n) => n.id === sel);
  const select = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      return needle ? notes.filter((n) => n.title.toLowerCase().includes(needle)) : notes;
    },
    [notes],
  );
  const members = useListState({
    key: "mapMembers",
    profileId,
    select,
    onPick: (n) => {
      if (graph) onToggleMember(n.id, graph.id);
    },
  });

  useEffect(() => {
    setGDraft(graph?.title ?? '');
    delConfirm.reset();
    setSel(null);
  }, [graph?.id, graph?.title]);

  const commitGraphTitle = () => {
    if (graph && gDraft.trim() && gDraft.trim() !== graph.title) onRenameGraph(graph.id, gDraft.trim());
    else if (graph) setGDraft(graph.title);
  };

  const newGraph = () => {
    const id = onCreateGraph('');
    setScope(id);
  };

  const removeGraph = () => {
    if (!graph) return;
    if (!delConfirm.confirm()) return;
    onDeleteGraph(graph.id);
    setScope('all');
    notify(tr('graphDeleted', lang));
  };

  return (
    <div className="g-map">
      <div className="g-gtabs">
        <button
          type="button"
          className={`g-chipbtn${scope === 'all' ? ' active' : ''}`}
          onClick={() => setScope('all')}
        >
          {tr('graphsAll', lang)} ({notes.length})
        </button>
        {graphs.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`g-chipbtn${scope === g.id ? ' active' : ''}`}
            onClick={() => setScope(g.id)}
          >
            {g.title} ({g.noteIds.length})
          </button>
        ))}
        <button type="button" className="g-btn sm" onClick={newGraph}>
          {tr('newGraph', lang)}
        </button>
      </div>

      {graph ? (
        <>
          <div className="g-ghead">
            <input
              className="g-gtitle-in"
              value={gDraft}
              onChange={(e) => setGDraft(e.target.value)}
              onBlur={commitGraphTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              aria-label="graph title"
            />
            <button type="button" className="g-btn sm" onClick={() => { members.changeQuery(""); setMembersOpen(true); }}>
              {tr('addNotes', lang)} ({graph.noteIds.length})
            </button>
            <button
              type="button"
              className={`g-btn sm${delConfirm.isArmed() ? ' g-danger-arm' : ''}`}
              onClick={removeGraph}
            >
              {delConfirm.isArmed() ? tr('confirmDel', lang) : tr('delGraph', lang)}
            </button>
          </div>

          {scopeNotes.length === 0 ? (
            <div className="muted">{tr('emptyCanvas', lang)}</div>
          ) : (
            <GraphCanvas lang={lang} nodes={scopeNotes} edges={edges} selectedId={sel} onSelect={setSel} />
          )}

          {selected && (
            <div className="g-preview-card">
              <strong>{selected.title}</strong>
              <span className="muted"> — {(selected.text || '').slice(0, PREVIEW_LEN) || '—'}</span>
              <button type="button" className="g-linkbtn" onClick={() => onOpen(selected.id)}>
                [{tr('openBtn', lang)}]
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {notes.length === 0 && <div className="muted">{tr('mapEmpty', lang)}</div>}
          <div className="g-clusters">
            {graphs.map((g) => (
              <div className="g-cluster" key={g.id}>
                <div className="g-cluster-t">
                  {g.title} ({g.noteIds.length})
                </div>
                <button type="button" className="g-btn sm" onClick={() => setScope(g.id)}>
                  [{tr('openBtn', lang)}]
                </button>
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div className="g-cluster">
                <div className="g-cluster-t">
                  {tr('ungrouped', lang)} ({ungrouped.length})
                </div>
                <div className="muted small">
                  {tr('listShownOf', lang).replace('{x}', String(Math.min(ungShown, ungrouped.length))).replace('{y}', String(ungrouped.length))}
                </div>
                {ungrouped.slice(0, ungShown).map((n) => (
                  <div className="g-sugg" key={n.id}>
                    <button type="button" className="g-linkbtn" onClick={() => onOpen(n.id)}>
                      {n.title || tr('newNoteTitle', lang)}
                    </button>
                  </div>
                ))}
                {ungShown < ungrouped.length && (
                  <button type="button" className="g-btn sm g-tpl-more" onClick={() => setUngShown((s) => s + 5)}>
                    {tr('tplShowMore', lang).replace('{n}', String(Math.min(5, ungrouped.length - ungShown)))}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="g-grid2">
        <div className="g-card danger">
          <div className="g-card-t">
            {tr('orphansTable', lang)} ({unlinked.length})
          </div>
          {unlinked.length === 0 && <div className="g-empty-ok">{tr('emptyOrphans', lang)}</div>}
          {unlinked.map((n) => (
            <div className="g-orphanrow g-sugg" key={n.id}>
              <span>{n.title || tr('newNoteTitle', lang)}</span>
              <button type="button" className="g-linkbtn" onClick={() => onOpen(n.id)}>
                [{tr('openBtn', lang)}]
              </button>
            </div>
          ))}
        </div>

        <div>
          <div className="g-card warn">
            <div className="g-card-t">
              {tr('brokenF', lang)} ({broken.length})
            </div>
            {broken.length === 0 && <div className="g-empty-ok">{tr('brokenEmpty', lang)}</div>}
            {broken.map((b) => (
              <div className="g-brokenrow g-sugg" key={b.id}>
                <span>
                  {b.id.slice(-4)} <span className="muted small">· {b.usedIn}</span>
                </span>
                <span>
                  <button
                    type="button"
                    className="g-linkbtn"
                    onClick={() => {
                      onPurge(b.id);
                      notify(tr('toastUnlinked', lang));
                    }}
                  >
                    [{tr('fixBtn', lang)}]
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="g-card">
            <div className="muted">{tr('emptyGraph', lang)}</div>
          </div>
        </div>
      </div>

      {membersOpen && graph && (
        <Modal title={`${tr('graphMembers', lang)} - ${graph.title}`} lang={lang} onClose={() => setMembersOpen(false)}>
          {notes.length === 0 && <div className="muted">{tr('mapEmpty', lang)}</div>}
          {notes.length > 0 && (
            <input
              className="g-in"
              value={members.query}
              onChange={(e) => members.changeQuery(e.target.value)}
              onKeyDown={members.nav.onKeyDown}
              placeholder={tr("linkSearchPh", lang)}
              aria-label="find member"
            />
          )}
          {notes.length > 0 && (
            <div className="g-seg" role="group" aria-label="limit">
              {TPL_LIMITS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={"g-btn sm" + (members.limit === n ? " active" : "")}
                  onClick={() => members.changeLimit(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {members.filtered.length === 0 && notes.length > 0 && (
            <div className="muted small" style={{ padding: 12 }}>{tr("linkEmpty", lang)}</div>
          )}
          {members.filtered.length > 0 && (
            <div className="muted small" style={{ padding: '4px 12px 0' }}>
              {tr("listShownOf", lang).replace("{x}", String(members.visible.length)).replace("{y}", String(members.filtered.length))}
            </div>
          )}
          {members.visible.map((n, i) => (
            <label
              className={"g-memberrow" + (i === members.nav.active ? " active" : "")}
              key={n.id}
              onMouseEnter={() => members.nav.setActive(i)}
            >
              <input
                type="checkbox"
                checked={graph.noteIds.includes(n.id)}
                onChange={() => onToggleMember(n.id, graph.id)}
              />
              <span>{<Hi text={n.title || tr("newNoteTitle", lang)} q={members.query} />}</span>
            </label>
          ))}
          {members.shown < members.filtered.length && (
            <button
              type="button"
              className="g-btn sm g-tpl-more"
              onClick={() => members.showMore()}
            >
              {tr("tplShowMore", lang).replace("{n}", String(Math.min(members.limit, members.filtered.length - members.shown)))}
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * Locked-map placeholder: preview stub plus the unlock rule with honest
 * progress and the reason, so the gate never reads as a bug. Static SVG,
 * no physics, no store writes.
 */
export function MapLocked({ lang, have, need, onNew }: { lang: Lang; have: number; need: number; onNew: () => void }) {
  return (
    <div className="g-page g-maplocked">
      <div className="g-maplocked-art" aria-hidden="true">
        <svg viewBox="0 0 320 180" width="320" height="180">
          <g stroke="var(--border)" strokeWidth="2">
            <line x1="70" y1="60" x2="150" y2="40" />
            <line x1="150" y1="40" x2="240" y2="70" />
            <line x1="70" y1="60" x2="120" y2="130" />
            <line x1="120" y1="130" x2="230" y2="130" />
            <line x1="240" y1="70" x2="230" y2="130" />
          </g>
          <g fill="var(--border)">
            <circle cx="70" cy="60" r="14" />
            <circle cx="150" cy="40" r="18" />
            <circle cx="240" cy="70" r="14" />
            <circle cx="120" cy="130" r="14" />
            <circle cx="230" cy="130" r="14" />
          </g>
        </svg>
        <span className="g-pro">Pro</span>
      </div>
      <h2 className="g-h2">
        {tr('proLocked', lang)} ({have}/{need})
      </h2>
      <div className="muted">{tr('mapLockedWhy', lang)}</div>
      <button type="button" className="g-btn sm primary" onClick={onNew}>
        {tr('newNote', lang)}
      </button>
    </div>
  );
}
