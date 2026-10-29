import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ForwardedRef } from 'react';
import type { Lang } from './i18n';
import { tr } from './i18n';
import { unlinkedNotes } from './store';
import type { Graph, Note } from './store';
import { Hi } from './widgets';
import { noteAccessibleName, noteDisplayName } from "./noteName";
import { useListState } from "./useListState";
import { TPL_LIMITS } from "./listPrefs";
import { PREVIEW_LEN } from "./promptUtils";
import { prefKeyFor } from "./prefs";

import { layoutGraph, liveGraph, type GPos as Pos, type LiveGraph } from './graphLayout';
import { MAP_H, MAP_W, ZOOM_MAX, ZOOM_MIN, boxHeight, centerView, fitView, revealShift } from './mapCamera';
import { useMedia } from './ui/useMedia';
import { edgePath, mapLabel } from './mapDraw';

export const HIT_R = 24;

/** Nearest node center to a content-space point. */
function nearestNode(nodes: { id: string }[], pos: Record<string, { x: number; y: number }>, x: number, y: number): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const n of nodes) {
    const c = pos[n.id] ?? { x: MAP_W / 2, y: MAP_H / 2 };
    const d = Math.hypot(x - c.x, y - c.y);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  return best;
}

export interface CanvasApi {
  centerOn: (id: string) => boolean;
  fit: () => void;
  zoom: (factor: number) => void;
  /** Where a note is drawn now (content space): pinning keeps it there. */
  positionOf: (id: string) => Pos | null;
  /** Pan just enough that the note is not under `cover` (the note card). */
  reveal: (id: string, cover: DOMRect) => void;
  /** Forget the arrangement: start again from the settled layout. */
  relayout: () => void;
}

function GraphCanvas({
  lang,
  nodes,
  edges,
  selectedId,
  onSelect,
  linkMode,
  onLinkTarget,
  onLinkCancel,
  hlOrphans,
  pinned,
  onPinMoved,
  apiRef,
}: {
  lang: Lang;
  nodes: Note[];
  edges: [string, string][];
  selectedId: string | null;
  onSelect: (id: string) => void;
  linkMode: boolean;
  onLinkTarget: (fromId: string, toId: string) => void;
  onLinkCancel: () => void;
  hlOrphans: boolean;
  /** Pinned notes of this scope: they hold still while others are dragged. */
  pinned: Record<string, Pos>;
  /** A pinned note was dragged to a new spot and stays pinned there. */
  onPinMoved: (id: string, at: Pos) => void;
  apiRef: ForwardedRef<CanvasApi>;
}) {
  const ids = nodes.map((n) => n.id);
  const edgeKey = edges.map((e) => e.join('>')).join('|');
  const scopeKey = ids.join(',') + '#' + edgeKey;
  const reduceMotion = useMedia('(prefers-reduced-motion: reduce)');
  const [pos, setPos] = useState<Record<string, Pos>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [layoutGen, setLayoutGen] = useState(0);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  // viewBox height follows the canvas proportions (width stays MAP_W units).
  const [boxH, setBoxH] = useState(MAP_H);
  const boxRef = useRef(boxH);
  boxRef.current = boxH;
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<LiveGraph | null>(null);
  const dragRef = useRef<null | {
    mode: 'pan' | 'node' | 'link';
    id?: string;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
  }>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const posRef = useRef(pos);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  // Pins the running simulation already applied (see the pin effect below).
  const pinPrev = useRef(pinned);
  const zoomRef = useRef((_cx: number, _cy: number, _f: number) => {});

  useEffect(() => {
    posRef.current = pos;
  });

  useImperativeHandle(apiRef, () => ({
    centerOn: (id: string) => {
      const p = posRef.current[id];
      if (!p) return false;
      const v = viewRef.current;
      setView({ ...v, ...centerView(p.x, p.y, v.k, MAP_W, boxRef.current) });
      return true;
    },
    fit: () => {
      setView(fitView(Object.values(posRef.current), MAP_W, boxRef.current));
    },
    zoom: (factor: number) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      zoomRef.current(r.left + r.width / 2, r.top + r.height / 2, factor);
    },
    positionOf: (id: string) => posRef.current[id] ?? null,
    reveal: (id: string, cover: DOMRect) => {
      const p = posRef.current[id];
      if (!p) return;
      const { r, s, ox, oy } = metrics();
      const v = viewRef.current;
      const pt = { x: r.left + ox + (p.x * v.k + v.x) * s, y: r.top + oy + (p.y * v.k + v.y) * s };
      const { dx, dy } = revealShift(pt, cover, r);
      if (dx || dy) setView({ ...v, x: v.x + dx / s, y: v.y + dy / s });
    },
    relayout: () => setLayoutGen((g) => g + 1),
  }), []);

  const metrics = () => {
    const el = svgRef.current;
    if (!el) return { r: new DOMRect(), s: 1, ox: 0, oy: 0 };
    const r = el.getBoundingClientRect();
    const h = boxRef.current;
    const s = Math.min(r.width / MAP_W, r.height / h);
    return { r, s, ox: (r.width - MAP_W * s) / 2, oy: (r.height - h * s) / 2 };
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
      const k2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
      return { k: k2, x: cx - ((cx - v.x) * k2) / v.k, y: cy - ((cy - v.y) * k2) / v.k };
    });
  };
  zoomRef.current = zoomAt;

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

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBoxH(boxHeight(r.width, r.height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A new canvas shape refits the graph (first measure, rotation, resize).
  const boxSeen = useRef(MAP_H);
  useEffect(() => {
    if (boxSeen.current === boxH) return;
    boxSeen.current = boxH;
    setView(fitView(Object.values(posRef.current), MAP_W, boxH));
  }, [boxH]);

  // One live simulation per scope (notes + links). Kept notes start where
  // they are drawn, new ones where the settled layout puts them; a scope
  // with other notes refits the camera, an edited link only lets springs settle.
  const prevKey = useRef('');
  const prevGen = useRef(layoutGen);
  useEffect(() => {
    const [idsPart] = scopeKey.split('#');
    const [prevIds] = prevKey.current.split('#');
    const fresh = layoutGraph(ids, edges);
    // «Reset layout» counts as another note set: settled start, camera refit.
    const relaid = prevGen.current !== layoutGen;
    prevGen.current = layoutGen;
    const sameNotes = idsPart === prevIds && !relaid;
    const start: Record<string, Pos> = {};
    for (const id of ids) {
      // Another note set starts from its own settled layout (no drift on a
      // scope switch); the same notes keep their places when a link changes.
      const p = (sameNotes ? posRef.current[id] : undefined) ?? fresh[id];
      if (p) start[id] = p;
    }
    let frame = 0;
    const sim = liveGraph(ids, edges, start, pinnedRef.current, reduceMotion ? undefined : () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPos(sim.positions());
      });
    });
    simRef.current = sim;
    // The new simulation already holds today's pins: nothing to diff later.
    pinPrev.current = pinnedRef.current;
    if (sameNotes && prevKey.current !== '' && prevKey.current !== scopeKey) sim.wake();
    const now = sim.positions();
    setPos(now);
    if (!sameNotes) setView(fitView(Object.values(now), MAP_W, boxRef.current));
    prevKey.current = scopeKey;
    return () => {
      sim.stop();
      if (frame) cancelAnimationFrame(frame);
      if (simRef.current === sim) simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, reduceMotion, layoutGen]);

  // Pin toggles reach the running simulation without restarting it.
  const pinKey = JSON.stringify(pinned);
  useEffect(() => {
    const sim = simRef.current;
    const before = pinPrev.current;
    pinPrev.current = pinned;
    if (!sim) return;
    for (const id of new Set([...Object.keys(before), ...Object.keys(pinned)])) {
      if (before[id] !== pinned[id]) sim.pin(id, pinned[id] ?? null);
    }
    setPos(sim.positions());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinKey]);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const p = toContent(e.clientX, e.clientY);
    const near = nearestNode(nodes, pos, p.x, p.y);
    const id = near && near.d <= HIT_R ? near.id : undefined;
    const v = viewRef.current;
    dragRef.current = {
      mode: linkMode ? 'link' : id ? 'node' : 'pan',
      id,
      sx: e.clientX,
      sy: e.clientY,
      ox: v.x,
      oy: v.y,
      moved: false,
    };
    if (linkMode && !id) onLinkCancel();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.mode === 'pan') {
      const { s } = metrics();
      const v = viewRef.current;
      setView({ ...v, x: d.ox + (e.clientX - d.sx) / s / v.k, y: d.oy + (e.clientY - d.sy) / s / v.k });
    } else if (d.mode === 'node' && d.id) {
      const sim = simRef.current;
      if (!sim) return;
      const p = toContent(e.clientX, e.clientY);
      sim.drag(d.id, p.x, p.y);
      // Without animation the neighbours still follow, a few steps per move.
      if (reduceMotion) {
        sim.step(6);
        setPos(sim.positions());
      }
    }
  };

  const endDrag = (cancelled: boolean, e?: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.mode === 'node' && d.id && d.moved) {
      const sim = simRef.current;
      const keep = !!pinnedRef.current[d.id];
      sim?.release(d.id, keep);
      if (sim && reduceMotion) {
        sim.step(200);
        setPos(sim.positions());
      }
      const at = sim?.positions()[d.id];
      if (keep && at && !cancelled) onPinMoved(d.id, at);
      return;
    }
    if (cancelled) return;
    if (d.mode === 'link') {
      // Drop target resolved from the release point (same hit rule as taps).
      if (d.id && e) {
        const p = toContent(e.clientX, e.clientY);
        const near = nearestNode(nodes, posRef.current, p.x, p.y);
        if (near && near.d <= HIT_R && near.id !== d.id) onLinkTarget(d.id, near.id);
      }
      return;
    }
    if (!d.moved && d.mode === 'node' && d.id) onSelect(d.id);
  };

  const deg = new Map<string, number>();
  for (const [a, b] of edges) {
    deg.set(a, (deg.get(a) ?? 0) + 1);
    deg.set(b, (deg.get(b) ?? 0) + 1);
  }
  const radius = (id: string) => 8 + Math.min(6, (deg.get(id) ?? 0) * 1.5);
  // A two-way relation (both notes link each other) is drawn once, bowed,
  // with arrows at both ends; before, one direction vanished under the other.
  const outgoing = new Set(nodes.flatMap((n) => n.linkedIds.map((t) => `${n.id}>${t}`)));

  return (
    <div className="m-canvaswrap">
      <svg
        ref={svgRef}
        className={'g-canvas' + (selectedId ? ' has-sel' : '')}
        viewBox={`0 0 ${MAP_W} ${boxH}`}
        role="group"
        tabIndex={0}
        aria-label={tr('kmap', lang)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(false, e)}
        onPointerCancel={() => endDrag(true)}
      >
        <defs>
          <marker id="g-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="g-varrow" />
          </marker>
          <marker id="g-arr-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="g-varrow hl" />
          </marker>
        </defs>
        <g className="g-view" transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {edges.map(([a, b]) => {
            const pa = pos[a];
            const pb = pos[b];
            if (!pa || !pb) return null;
            const mutual = outgoing.has(`${a}>${b}`) && outgoing.has(`${b}>${a}`);
            // Ends stop at the node rims, so the arrow tips stay visible.
            const d = edgePath(pa, pb, radius(a) + 3, radius(b) + 3, mutual);
            if (!d) return null;
            const near = selectedId === a || selectedId === b || hoverId === a || hoverId === b;
            const arrow = near ? 'url(#g-arr-hl)' : 'url(#g-arr)';
            return (
              <path
                key={`${a}>${b}`}
                className={'g-vedge' + (near ? ' hl' : '') + (mutual ? ' both' : '')}
                d={d}
                data-edge={`${a}>${b}`}
                markerEnd={arrow}
                markerStart={mutual ? arrow : undefined}
              />
            );
          })}
          {nodes.map((n) => {
            const p = pos[n.id] ?? { x: MAP_W / 2, y: MAP_H / 2 };
            const r = radius(n.id);
            const sel = selectedId === n.id;
            const orph = !deg.has(n.id);
            const pin = !!pinned[n.id];
            return (
              <g
                key={n.id}
                data-node={n.id}
                data-pinned={pin ? 'true' : undefined}
                tabIndex={0}
                role="button"
                aria-label={noteAccessibleName(n, lang) + (pin ? ` · ${tr('mapPinned', lang)}` : '')}
                onPointerEnter={() => setHoverId(n.id)}
                onPointerLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                onFocus={() => setHoverId(n.id)}
                onBlur={() => setHoverId((h) => (h === n.id ? null : h))}
                onKeyDown={(ke) => {
                  if (ke.key === 'Enter' || ke.key === ' ') {
                    ke.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                <circle className="g-vhit" cx={p.x} cy={p.y} r={HIT_R} fill="transparent" />
                {pin && <circle className="g-vpin" cx={p.x} cy={p.y} r={r + 5} />}
                <circle
                  className={`g-vnode${sel ? ' sel' : ''}${orph ? ' orph' : ''}${hlOrphans ? (orph ? ' hl' : ' dim') : ''}`}
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  data-id={n.id}
                />
              </g>
            );
          })}
          {/* Labels paint above every node; the focused one last, so its full name is never covered. */}
          <g className="g-vlabels" aria-hidden="true">
            {[...nodes]
              .sort((x, y) => Number(x.id === selectedId || x.id === hoverId) - Number(y.id === selectedId || y.id === hoverId))
              .map((n) => {
                const focus = selectedId === n.id || hoverId === n.id;
                const label = mapLabel(noteDisplayName(n, lang), focus, view.k);
                const p = pos[n.id];
                if (!label || !p) return null;
                return (
                  <text key={n.id} className={"g-vlabel" + (focus ? " focus" : "") + (!n.title.trim() ? " g-note-derived" : "")} data-label={n.id} x={p.x} y={p.y + radius(n.id) + 14}>
                    {label}
                  </text>
                );
              })}
          </g>
        </g>
      </svg>
    </div>
  );
}

type MemberFilter = "all" | "in" | "out";
type PinMap = Record<string, Record<string, Pos>>;

/** Stored pins; anything malformed is ignored (a pin is a convenience, not data). */
function readPins(key: string): PinMap {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: PinMap = {};
    for (const [scope, list] of Object.entries(raw)) {
      if (!list || typeof list !== 'object') continue;
      const kept: Record<string, Pos> = {};
      for (const [id, p] of Object.entries(list)) {
        const x: unknown = p && typeof p === 'object' ? Reflect.get(p, 'x') : undefined;
        const y: unknown = p && typeof p === 'object' ? Reflect.get(p, 'y') : undefined;
        if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) kept[id] = { x, y };
      }
      out[scope] = kept;
    }
    return out;
  } catch {
    return {};
  }
}

export function MapView({
  lang,
  notes,
  graphs,
  notify,
  notifyAction,
  onOpen,
  onPurge,
  onCreateGraph,
  onRenameGraph,
  onDeleteGraph,
  onToggleMember,
  onLinkNotes,
  profileId, routeParam, onRoute,
}: {
  lang: Lang;
  notes: Note[];
  graphs: Graph[];
  notify: (msg: string) => void;
  /** Toast with Undo (N4): «Reset layout» drops the pins of this scope. */
  notifyAction: (text: string, actionLabel: string, fn: () => void) => void;
  onOpen: (id: string) => void;
  onPurge: (id: string) => void;
  onCreateGraph: (title: string) => string;
  onRenameGraph: (id: string, title: string) => void;
  onDeleteGraph: (id: string) => void;
  onToggleMember: (noteId: string, graphId: string) => void;
  onLinkNotes: (fromId: string, toId: string) => void;
  profileId: string; routeParam?: string; onRoute: (param?: string) => void;
}) {
  const [scope, setScope] = useState<string>("all");
  const [peekId, setPeekId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFind, setLinkFind] = useState<{ x: number; y: number } | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchGo, setSearchGo] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQ, setSwitcherQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [gDraft, setGDraft] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberFilter, setMemberFilter] = useState<MemberFilter>("all");
  const [hlOrphans, setHlOrphans] = useState(false);
  const apiRef = useRef<CanvasApi | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Pinned notes per scope, a per-profile UI pref (layout, not note data).
  const pinsKey = prefKeyFor('mapPins', profileId);
  const [pins, setPins] = useState<PinMap>(() => readPins(pinsKey));
  useEffect(() => setPins(readPins(pinsKey)), [pinsKey]);
  const updatePins = (scopeId: string, change: (cur: Record<string, Pos>) => Record<string, Pos>) => {
    setPins((all) => {
      const next = { ...all, [scopeId]: change(all[scopeId] ?? {}) };
      try {
        window.localStorage.setItem(pinsKey, JSON.stringify(next));
      } catch {
        /* the pin still holds for this session */
      }
      return next;
    });
  };
  const routeNote = routeParam?.startsWith('note/') ? routeParam.slice(5) : null;
  useEffect(() => {
    setScope(routeNote ? 'all' : routeParam && (routeParam === 'ungrouped' || graphs.some(g => g.id === routeParam)) ? routeParam : 'all');
    setPeekId(routeNote && notes.some(n => n.id === routeNote) ? routeNote : null);
    const frame = requestAnimationFrame(() => { if (routeNote) apiRef.current?.centerOn(routeNote); });
    return () => cancelAnimationFrame(frame);
    // Routing changes selection; graph edits never reset a user's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParam]);

  const graph = graphs.find((g) => g.id === scope) ?? null;
  const scopeNotes = graph ? notes.filter((n) => graph.noteIds.includes(n.id)) : scope === "ungrouped" ? notes.filter((n) => !graphs.some((g) => g.noteIds.includes(n.id))) : notes;
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
        const k = [n.id, t].sort().join(">");
        if (!edgeSet.has(k)) {
          edgeSet.add(k);
          edges.push([n.id, t]);
        }
      }
    }
  }

  const searchPool = searchQ.trim()
    ? notes.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(searchQ.trim().toLowerCase())).slice(0, 6)
    : [];
  const switchGraphs = switcherQ.trim()
    ? graphs.filter((g) => g.title.toLowerCase().includes(switcherQ.trim().toLowerCase()))
    : graphs;
  const linkPool = linkQuery.trim()
    ? notes.filter((n) => n.id !== peekId && `${n.title} ${n.text}`.toLowerCase().includes(linkQuery.trim().toLowerCase())).slice(0, 6)
    : notes.filter((n) => n.id !== peekId).slice(0, 6);

  const scopeLabel = graph
    ? `${graph.title} (${graph.noteIds.length})`
    : scope === "ungrouped"
      ? `${tr("ungrouped", lang)} (${ungrouped.length})`
      : `${tr("graphsAll", lang)} (${notes.length})`;

  const pickSearch = (id: string) => {
    setSearchGo(false);
    setSearchQ("");
    if (apiRef.current?.centerOn(id)) setPeekId(id);
  };

  const makeLink = (fromId: string, toId: string) => {
    setLinkMode(false);
    setLinkFind(null);
    onLinkNotes(fromId, toId);
  };

  // `/` finds a node, Esc unwinds topmost UI (drawers, popups, link mode).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && !!t.closest && !!t.closest("input, textarea, select, [contenteditable]");
      const inModal = !!t && !!t.closest && !!t.closest(".g-modal");
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !inField && !inModal) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && !inModal) {
        if (linkMode) setLinkMode(false);
        else if (switcherOpen) setSwitcherOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else if (linkFind) setLinkFind(null);
        else if (membersOpen) setMembersOpen(false);
        else if (peekId) setPeekId(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkMode, switcherOpen, menuOpen, linkFind, membersOpen, peekId]);

  const select = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      const base = needle ? notes.filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(needle)) : notes;
      if (!graph) return base;
      if (memberFilter === "in") return base.filter((n) => graph.noteIds.includes(n.id));
      if (memberFilter === "out") return base.filter((n) => !graph.noteIds.includes(n.id));
      return base;
    },
    [notes, graph, memberFilter],
  );
  const members = useListState({
    key: "mapMembers",
    profileId,
    select,
    onPick: (n) => {
      if (graph) onToggleMember(n.id, graph.id);
    },
  });

  const bulkAddVisible = () => {
    if (!graph) return;
    const missing = members.filtered.filter((n) => !graph.noteIds.includes(n.id));
    const targets = missing.length > 0 ? missing : members.filtered;
    for (const n of targets) onToggleMember(n.id, graph.id);
  };

  const commitGraphTitle = () => {
    if (graph && gDraft.trim() && gDraft.trim() !== graph.title) onRenameGraph(graph.id, gDraft.trim());
    setRenaming(false);
  };

  const removeGraph = () => {
    if (!graph) return;
    onDeleteGraph(graph.id);
    setScope("all");
    onRoute();
    setMenuOpen(false);
  };

  const peek = peekId ? (notes.find((n) => n.id === peekId) ?? null) : null;
  const scopePins = pins[scope] ?? {};
  // The note card must not hide its own note: pan once the card is drawn.
  useEffect(() => {
    if (!peekId) return;
    const frame = requestAnimationFrame(() => {
      const card = document.querySelector('[data-testid="map-peek"]');
      if (card) apiRef.current?.reveal(peekId, card.getBoundingClientRect());
    });
    return () => cancelAnimationFrame(frame);
  }, [peekId]);
  const pinAll = () => {
    const at: Record<string, Pos> = {};
    for (const n of scopeNotes) {
      const p = apiRef.current?.positionOf(n.id);
      if (p) at[n.id] = { x: p.x, y: p.y };
    }
    updatePins(scope, () => at);
    setMenuOpen(false);
    notify(tr('mapPinnedAll', lang).replace('{n}', String(Object.keys(at).length)));
  };
  const resetLayout = () => {
    const before = scopePins;
    const scopeId = scope;
    updatePins(scopeId, () => ({}));
    apiRef.current?.relayout();
    setMenuOpen(false);
    notifyAction(tr('mapLayoutReset', lang), tr('undoToast', lang), () => updatePins(scopeId, () => before));
  };
  const togglePin = (id: string) => {
    const at = scopePins[id] ? null : apiRef.current?.positionOf(id);
    updatePins(scope, (cur) => {
      const next = { ...cur };
      if (at) next[id] = { x: at.x, y: at.y };
      else delete next[id];
      return next;
    });
  };

  return (
    <div className="m-map" data-testid="map-view">
      {routeNote && <button type="button" className="g-btn sm" data-testid="map-return-note" onClick={() => onOpen(routeNote)}>← {tr("goBack", lang)}</button>}
      <div className="m-searchrow">
        <input
          ref={searchRef}
          className="g-in"
          data-testid="map-search"
          autoComplete="off"
          value={searchQ}
          onChange={(e) => {
            setSearchQ(e.target.value);
            setSearchGo(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && searchPool.length > 0) {
              e.preventDefault();
              const first = searchPool[0];
              if (first) pickSearch(first.id);
            }
            if (e.key === "Escape") {
              setSearchQ("");
              setSearchGo(false);
            }
          }}
          placeholder={tr("linkSearchPh", lang)}
          aria-label="find node"
        />
        {searchGo && searchPool.length > 0 && (
          <div className="m-searchpop" role="listbox">
            {searchPool.map((n) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={false}
                className="n-suggestitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSearch(n.id)}
              >
                <span className={!n.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(n, lang)}><Hi text={noteDisplayName(n, lang)} q={searchQ} /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <div className="muted">{tr("emptyGraph", lang)}</div>
      ) : (
        <GraphCanvas
          lang={lang}
          nodes={scopeNotes}
          edges={edges}
          selectedId={peekId}
          onSelect={setPeekId}
          linkMode={linkMode}
          onLinkTarget={makeLink}
          onLinkCancel={() => setLinkMode(false)}
          hlOrphans={hlOrphans}
          pinned={scopePins}
          onPinMoved={(id, at) => updatePins(scope, (cur) => ({ ...cur, [id]: at }))}
          apiRef={apiRef}
        />
      )}

      <div className="m-tools" data-testid="map-tools" role="toolbar" aria-label={tr("kmap", lang)}>
        <button
          type="button"
          className="m-toolbtn"
          title={tr("zoomOutT", lang)}
          aria-label={tr("zoomOutT", lang)}
          onClick={() => apiRef.current?.zoom(0.8)}
        >
          −
        </button>
        <button
          type="button"
          className="m-toolbtn"
          title={tr("zoomInT", lang)}
          aria-label={tr("zoomInT", lang)}
          onClick={() => apiRef.current?.zoom(1.25)}
        >
          +
        </button>
        <button
          type="button"
          className="m-toolbtn wide"
          title={tr("mapFit", lang)}
          aria-label={tr("mapFit", lang)}
          onClick={() => apiRef.current?.fit()}
        >
          {tr("mapFit", lang)}
        </button>
        <span className="m-switchwrap">
          {renaming && graph ? (
            <input
              autoFocus
              autoComplete="off"
              className="g-gtitle-in m-rename"
              value={gDraft}
              onChange={(e) => setGDraft(e.target.value)}
              onBlur={commitGraphTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape" && graph) {
                  setGDraft(graph.title);
                  setRenaming(false);
                }
              }}
              aria-label="graph title"
            />
          ) : (
            <button
              type="button"
              data-testid="map-graphs"
              className="m-toolbtn wide"
              aria-expanded={switcherOpen}
              onClick={() => {
                setSwitcherOpen((v) => !v);
                setSwitcherQ("");
              }}
            >
              {scopeLabel} ▾
            </button>
          )}
          {switcherOpen && (
            <span className="m-pop" role="menu" data-testid="map-graphs-pop">
              <input
                autoFocus
                className="g-in m-pop-search"
                value={switcherQ}
                onChange={(e) => setSwitcherQ(e.target.value)}
                placeholder={tr("linkSearchPh", lang)}
                aria-label="find graph"
              />
              <button
                type="button"
                role="menuitem"
                className="m-popitem"
                onClick={() => {
                  setScope("all");
                  onRoute();
                  setSwitcherOpen(false);
                }}
              >
                {tr("graphsAll", lang)} ({notes.length})
              </button>
              {switchGraphs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="menuitem"
                  className="m-popitem"
                  onClick={() => {
                    setScope(g.id);
                    onRoute(g.id);
                    setSwitcherOpen(false);
                  }}
                >
                  {g.title} ({g.noteIds.length})
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="m-popitem"
                onClick={() => {
                  setScope("ungrouped");
                  onRoute("ungrouped");
                  setSwitcherOpen(false);
                }}
              >
                {tr("ungrouped", lang)} ({ungrouped.length})
              </button>
              <button
                type="button"
                role="menuitem"
                className="m-popitem"
                onClick={() => {
                  const id = onCreateGraph("");
                  setScope(id);
                  onRoute(id);
                  setSwitcherOpen(false);
                }}
              >
                {tr("newGraph", lang)}
              </button>
            </span>
          )}
        </span>
        <span className="n-morewrap">
          <button
            type="button"
            data-testid="map-menu"
            className="m-toolbtn"
            title={tr("menu", lang)}
            aria-label={tr("menu", lang)}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <span className="n-menu m-up" role="menu">
              <button type="button" role="menuitem" className="n-menuitem" data-testid="map-pin-all" disabled={scopeNotes.length === 0} onClick={pinAll}>
                {tr('mapPinAll', lang)}
              </button>
              <button type="button" role="menuitem" className="n-menuitem" data-testid="map-reset-layout" disabled={scopeNotes.length === 0} onClick={resetLayout}>
                {tr('mapResetLayout', lang)}
              </button>
              {graph && <div className="n-menusep" role="separator" />}
              {graph && (
                <button
                  type="button"
                  role="menuitem"
                  className="n-menuitem"
                  onClick={() => {
                    setGDraft(graph.title);
                    setRenaming(true);
                    setMenuOpen(false);
                  }}
                >
                  {tr("renameGo", lang)}
                </button>
              )}
              {graph && (
                <button
                  type="button"
                  role="menuitem"
                  className="n-menuitem"
                  onClick={() => {
                    members.changeQuery("");
                    setMembersOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  {tr("mapCompose", lang)}
                </button>
              )}
              {graph && <div className="n-menusep" role="separator" />}
              {graph && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="map-menu-del"
                  className="n-menuitem danger"
                  onClick={removeGraph}
                >
                  {tr("delGraph", lang)}
                </button>
              )}
            </span>
          )}
        </span>
        <button
          type="button"
          data-testid="map-link"
          className={"m-toolbtn" + (linkMode ? " active" : "")}
          title={tr("addLinkBtn", lang)}
          aria-label={tr("addLinkBtn", lang)}
          aria-pressed={linkMode}
          onClick={() => setLinkMode((v) => !v)}
        >
          ⚡
        </button>
        <button
          type="button"
          data-testid="map-orphans"
          className={"m-chipbtn" + (hlOrphans ? " active" : "")}
          aria-pressed={hlOrphans}
          onClick={() => setHlOrphans((v) => !v)}
        >
          {tr("orphansT", lang)} ({unlinked.length})
        </button>
      </div>
      {linkMode && (
        <div className="m-linkbar" role="status">
          {tr("mapLinkHint", lang)}
          <button type="button" className="g-linkbtn" onClick={() => setLinkMode(false)}>
            ×
          </button>
        </div>
      )}
      {edges.length === 0 && notes.length > 0 && (
        <div className="muted m-hint">{tr("mapHint", lang)}</div>
      )}
      {broken.length > 0 && (
        <div className="m-broken" data-testid="map-broken">
          <span className="muted small">
            {tr("brokenF", lang)} ({broken.length})
          </span>
          {broken.map((b) => (
            <span className="g-brokenrow g-sugg" key={b.id}>
              <span>
                {b.id.slice(-4)} <span className="muted small">· {b.usedIn}</span>
              </span>
              <button
                type="button"
                className="g-linkbtn"
                onClick={() => {
                  onPurge(b.id);
                  notify(tr("toastUnlinked", lang));
                }}
              >
                [{tr("fixBtn", lang)}]
              </button>
            </span>
          ))}
        </div>
      )}

      {peek && (
        <aside className="m-peek" data-testid="map-peek" role="dialog" aria-label={noteAccessibleName(peek, lang)}>
          <button type="button" className="t-panel-x" aria-label={tr("closeBtn", lang)} onClick={() => setPeekId(null)}>
            ×
          </button>
          <div className={"m-peek-t" + (!peek.title.trim() ? " g-note-derived" : "")}>{noteDisplayName(peek, lang)}</div>
          <div className="muted small">{(peek.text || "").slice(0, PREVIEW_LEN) || "—"}</div>
          <div className="m-peek-actions">
            <button type="button" className="g-btn sm primary" onClick={() => onOpen(peek.id)}>
              {tr("openBtn", lang)}
            </button>
            <button
              type="button"
              className="g-btn sm"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const p = { x: Math.max(8, Math.min(r.left, (window.innerWidth || 1024) - 300)), y: Math.max(8, r.bottom + 8) };
                setLinkFind({ x: p.x, y: p.y });
                setLinkQuery("");
              }}
            >
              {tr("addLinkBtn", lang)}
            </button>
            <button
              type="button"
              className="g-btn sm"
              data-testid="map-pin"
              aria-pressed={!!scopePins[peek.id]}
              title={tr("mapPinHint", lang)}
              onClick={() => togglePin(peek.id)}
            >
              {scopePins[peek.id] ? tr("mapUnpin", lang) : tr("mapPin", lang)}
            </button>
          </div>
          {linkFind && (
            <div
              className="n-suggest m-linkfind"
              role="listbox"
              style={{ left: linkFind.x, top: linkFind.y }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setLinkFind(null);
              }}
            >
              <input
                autoFocus
                className="g-in n-suggest-search"
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
                placeholder={tr("linkSearchPh", lang)}
                aria-label="find note"
              />
              {linkPool.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="n-suggestitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => makeLink(peek.id, n.id)}
                  >
                    <span className={!n.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(n, lang)}><Hi text={noteDisplayName(n, lang)} q={linkQuery} /></span>
                  </button>
                ))}
            </div>
          )}
        </aside>
      )}

      {membersOpen && graph && (
        <div className="m-drawerwrap">
          <div className="m-backdrop" onClick={() => setMembersOpen(false)} />
          <aside
            className="m-drawer"
            data-testid="map-members"
            role="dialog"
            aria-label={`${tr("graphMembers", lang)} — ${graph.title}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMembersOpen(false);
            }}
          >
            <button type="button" className="t-panel-x" aria-label={tr("closeBtn", lang)} onClick={() => setMembersOpen(false)}>
              ×
            </button>
            <div className="g-card-t">
              {tr("graphMembers", lang)} — {graph.title}
            </div>
            <input
              className="g-in"
              value={members.query}
              onChange={(e) => members.changeQuery(e.target.value)}
              onKeyDown={members.nav.onKeyDown}
              placeholder={tr("linkSearchPh", lang)}
              aria-label="find member"
            />
            <div className="g-seg" role="group" aria-label="membership">
              {(
                [
                  ["all", tr("tplFAll", lang)],
                  ["in", tr("mapIn", lang)],
                  ["out", tr("mapOut", lang)],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={"g-btn sm" + (memberFilter === v ? " active" : "")}
                  onClick={() => {
                    setMemberFilter(v);
                    members.resetShown();
                    members.resetNavigation();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
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
            <button type="button" className="g-btn sm g-wide" onClick={bulkAddVisible}>
              {tr("mapBulk", lang)}
            </button>
            {members.filtered.length > 0 && (
              <div className="muted small">
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
                <span className={!n.title.trim() ? "g-note-derived" : undefined} title={noteAccessibleName(n, lang)}>{<Hi text={noteDisplayName(n, lang)} q={members.query} />}</span>
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
          </aside>
        </div>
      )}
    </div>
  );
}
