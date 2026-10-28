import type { JSONContent } from '@tiptap/core';
import type { AIModel, LlmTpl } from './data';
import { newId } from './utils/newId';

export interface Note {
  id: string;
  title: string;
  /** Tiptap document (JSON) or legacy HTML string (migrated on first open). */
  content: string | JSONContent;
  /** Plain text cache for word count, export and search. */
  text: string;
  /** Outgoing links as note ids (never titles). */
  linkedIds: string[];
  calcs: CalcBlock[];
  /** Last edit timestamp (ms). */
  updated: number;
}

export interface CalcBlock {
  id: string;
  name: string;
  expr: string;
}

export interface PromptSave {
  id: string;
  kind: 'image' | 'llm';
  title: string;
  model?: AIModel;
  tokens?: string[];
  templateId?: string;
  params?: Record<string, string>;
  noteId?: string;
  created: number;
}

export interface TaskItem {
  id: string;
  text: string;
  /** Optional details, edited in the task dialog. */
  desc?: string;
  done: boolean;
  /** ISO date YYYY-MM-DD (legacy "DD.MM" strings may occur in old stores). */
  due?: string;
  /** Source note context; absent for standalone tasks. */
  noteId?: string;
}

export interface Graph {
  id: string;
  title: string;
  noteIds: string[];
}

export interface Store {
  notes: Note[];
  tasks: TaskItem[];
  trash: Note[];
  trashTasks: TaskItem[];
  graphs: Graph[];
  prompts: PromptSave[];
  /** User-created templates (built-ins live in data.ts). */
  customTpls: LlmTpl[];
  activeId: string;
}

/** Increment on every breaking store change; drives migrate(). v4 turns customTpls into slot bodies, v5 adds task trash, v6 image templates keep model/tokens. */
export const SCHEMA_VERSION = 6;

/** Pre-profiles single-store key; read once when migrating to the default profile. */
export const LEGACY_STORE_KEY = 'grafnot-store-v2';

/** Per-profile store key: every profile owns an isolated payload. */
export function storeKeyFor(profileId: string): string {
  return `grafnot-store-${profileId}`;
}

export interface StoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function strip(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface LooseNote {
  id: string;
  title: string;
  notebook?: string;
  content?: string | JSONContent;
  bodyHtml?: string;
  text?: string;
  /** Legacy v1 links by title. */
  linked?: string[];
  linkedIds?: string[];
  calcs?: CalcBlock[];
  updated?: number;
}

export interface LooseTpl {
  id: string;
  title: string;
  p1label?: string;
  p1?: string;
  p2label?: string;
  p2?: string;
}

/** A v4 template already living in the store (passthrough shape). */
export interface StoredTpl {
  id: string;
  name: string;
  body: string;
  defaults?: Record<string, string>;
  kind?: unknown;
  model?: unknown;
  tokens?: unknown;
}

const AI_MODELS: readonly unknown[] = ['Pony', 'SDXL', 'Flux'];

export interface LooseStore {
  notes: LooseNote[];
  tasks: TaskItem[];
  trash?: LooseNote[];
  trashTasks?: TaskItem[];
  prompts?: PromptSave[];
  customTpls?: Array<LooseTpl | StoredTpl>;
  graphs?: Graph[];
  schemaVersion?: number;
  activeId: string;
}

/**
 * Pure migration to the current schema (no window access — unit-testable).
 * Branches on the payload's schemaVersion (unversioned blobs are v1):
 * v1 -> v2: notebook => graph membership, linked (titles) => linkedIds;
 * v2 -> v3: customTpls defaults to [] (sanitized, damaged entries dropped);
 * v3 -> v4: fixed p1/p2 templates become slot bodies (best-effort, tested);
 * v4 -> v5: trashTasks defaults to [];
 * v5 -> v6: image templates keep kind/model/tokens (optional, nothing to convert).
 * The notebook flow runs only for real legacy: payloads without a graphs
 * array, or with notebook fields on notes (a graphs array alone counts as v2+).
 * Damaged array elements (non-objects; tasks/trashTasks/prompts/graphs with
 * a wrong shape) are dropped and counted in droppedItems; valid elements pass
 * through untouched. Unknown top-level fields ride along in `rest`.
 * Missing link targets are dropped and counted. Trash keeps its fields
 * (linkedIds, calcs, text, updated); existing updated stamps are never
 * rewritten. Idempotent through the save/load cycle (saves stamp v6).
 */
/** Clean a legacy slot label into a usable {{name}} (fallback if empty). */
function cleanSlotName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').replace(/[{}]/g, '').slice(0, 24) : '';
  return s || fallback;
}

/**
 * v3 customTpl (fixed p1/p2) -> v4 slot body. Best-effort: label text
 * becomes the slot name, values become defaults. Null = damaged, drop it.
 */
export function convertLegacyTpl(t: LooseTpl): LlmTpl | null {
  if (!t || typeof t.id !== 'string' || typeof t.title !== 'string') return null;
  const n1 = cleanSlotName(t.p1label, 'var1');
  let n2 = cleanSlotName(t.p2label, 'var2');
  if (n2 === n1) n2 = `${n2}_2`;
  const body = t.title
    .replace(/\{\{\s*p1\s*\}\}/g, `{{${n1}}}`)
    .replace(/\{\{\s*p2\s*\}\}/g, `{{${n2}}}`);
  const name = t.title.replace(/\{\{\s*p[12]\s*\}\}/g, '').replace(/\s+/g, ' ').trim() || 'Шаблон';
  const defaults: Record<string, string> = {};
  if (typeof t.p1 === 'string') defaults[n1] = t.p1;
  if (typeof t.p2 === 'string') defaults[n2] = t.p2;
  return { id: t.id, name, body, defaults };
}

/** v4 entries pass through (sanitized); v3 entries convert; garbage drops. */
function convertTpls(raw: Array<LooseTpl | StoredTpl> | undefined): LlmTpl[] {
  if (!Array.isArray(raw)) return [];
  const out: LlmTpl[] = [];
  for (const t of raw) {
    if (t && typeof (t as StoredTpl).name === 'string' && typeof (t as StoredTpl).body === 'string' && typeof t.id === 'string') {
      const st = t as StoredTpl;
      const defaults: Record<string, string> = {};
      if (st.defaults && typeof st.defaults === 'object') {
        for (const [k, v] of Object.entries(st.defaults)) {
          if (typeof v === 'string') defaults[k] = v;
        }
      }
      const tpl: LlmTpl = { id: t.id, name: st.name, body: st.body, defaults };
      // v6 image fields: kept when well-formed; a damaged field drops alone
      // (the workbench then re-reads tags from the body).
      if (st.kind === 'image') tpl.kind = 'image';
      if (AI_MODELS.includes(st.model)) tpl.model = st.model as AIModel;
      if (Array.isArray(st.tokens) && st.tokens.every((x) => typeof x === 'string')) tpl.tokens = [...st.tokens];
      out.push(tpl);
      continue;
    }
    const c = convertLegacyTpl(t as LooseTpl);
    if (c) out.push(c);
  }
  return out;
}

/** Load status of a stored payload: absent (no key), corrupt (unreadable),
 * future (newer schemaVersion — never migrate or overwrite), ok. */
export type LoadStatus = 'ok' | 'absent' | 'corrupt' | 'future';

export interface LoadResult {
  status: LoadStatus;
  store?: Store;
  droppedLinks: number;
  droppedItems: number;
  rest?: Record<string, unknown>;
  /** Verbatim raw payload for corrupt/future (backup and export). */
  raw?: string;
}

/** Plain object (not null, not an array): damaged array elements drop out. */
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isTaskItem(t: unknown): t is TaskItem {
  return isObj(t) && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean';
}

function isPromptSave(p: unknown): p is PromptSave {
  return (
    isObj(p) &&
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    (p.kind === 'image' || p.kind === 'llm')
  );
}

function isGraphShape(g: unknown): g is Graph {
  return isObj(g) && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.noteIds);
}

/** Keep valid elements untouched (same references); count the dropped. Non-arrays default to []. */
function sanitize<T>(arr: unknown, keep: (v: unknown) => v is T): { list: T[]; dropped: number } {
  if (!Array.isArray(arr)) return { list: [], dropped: 0 };
  const list: T[] = [];
  let dropped = 0;
  for (const v of arr) {
    if (keep(v)) list.push(v);
    else dropped++;
  }
  return { list, dropped };
}

/** Top-level payload fields owned by the schema; everything else rides along in `rest`. */
const KNOWN_TOP_FIELDS = new Set([
  'notes',
  'tasks',
  'trash',
  'trashTasks',
  'graphs',
  'prompts',
  'customTpls',
  'activeId',
  'schemaVersion',
]);
/** Schema version carried by a stored payload; unversioned blobs are v1 legacy. */
function versionOf(raw: LooseStore): number {
  const v = raw.schemaVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Defensive read: a single damaged graph must not sink the whole store. */
function memberIds(g: Graph): string[] {
  return Array.isArray(g.noteIds) ? g.noteIds : [];
}

export function migrate(raw: LooseStore): {
  store: Store;
  droppedLinks: number;
  droppedItems: number;
  rest: Record<string, unknown>;
} {
  const from = versionOf(raw);
  const rawNotes = Array.isArray(raw.notes) ? raw.notes : [];
  const rawTrash = Array.isArray(raw.trash) ? raw.trash : [];
  const cleanNotes = rawNotes.filter(isObj) as LooseNote[];
  const cleanTrash = rawTrash.filter(isObj) as LooseNote[];
  let droppedItems = rawNotes.length - cleanNotes.length + (rawTrash.length - cleanTrash.length);
  const conv = (n: LooseNote): Note => ({
    id: n.id,
    title: n.title,
    content: n.content !== undefined ? n.content : (n.bodyHtml ?? ''),
    text: n.text ?? (n.bodyHtml !== undefined ? strip(n.bodyHtml) : ''),
    linkedIds: Array.isArray(n.linkedIds) ? [...n.linkedIds] : [],
    calcs: Array.isArray(n.calcs) ? n.calcs : [],
    updated: typeof n.updated === 'number' ? n.updated : Date.now(),
  });
  const notes = cleanNotes.map(conv);
  const byId = new Set(notes.map((n) => n.id));
  const raws = cleanNotes;

  // v1 and unversioned legacy: notebooks become graphs and every note lands
  // in at least its notebook graph. v2+ membership is authoritative: only
  // dangling member ids are dropped, nothing is invented.
  // The notebook flow runs only for real legacy: payloads without a graphs
  // array, or with notebook fields on notes (a graphs array alone counts as v2+).
  const hasGraphs = Array.isArray(raw.graphs);
  const rawGraphs: unknown[] = hasGraphs ? (raw.graphs as unknown[]) : [];
  const shapedGraphs: Graph[] = [];
  for (const g of rawGraphs) {
    if (!isGraphShape(g)) {
      droppedItems++;
      continue;
    }
    shapedGraphs.push({ ...g, noteIds: memberIds(g).filter((id) => byId.has(id)) });
  }
  let graphs: Graph[] = hasGraphs ? shapedGraphs : [];
  const hasNotebook = cleanNotes.some((n) => n.notebook !== undefined);
  const notebookFlow = from <= 1 && (!hasGraphs || hasNotebook);
  if (notebookFlow && !hasGraphs) {
    // First-run migration from notebooks.
    const nb = new Map<string, string[]>();
    for (const n of raws) {
      const name = n.notebook ?? 'HCI';
      const arr = nb.get(name) ?? [];
      arr.push(n.id);
      nb.set(name, arr);
    }
    graphs = [...nb.entries()].map(([title, noteIds], i) => ({
      id: `${newId("g")}_${i}`,
      title,
      noteIds: noteIds.filter((id) => byId.has(id)),
    }));
  }
  if (notebookFlow) {
  // Every legacy note ends up in its notebook graph (unless already in a same-titled one).
  const nbOf = new Map(raws.map((n) => [n.id, n.notebook ?? 'HCI']));
  for (const n of notes) {
    const name = nbOf.get(n.id) ?? 'HCI';
    let g = graphs.find((x) => x.title === name);
    if (!g) {
      g = { id: `${newId("g")}_nb_${graphs.length}`, title: name, noteIds: [] };
      graphs.push(g);
    }
    if (g.noteIds.includes(n.id)) continue;
    g.noteIds.push(n.id);
  }
  }

  // Title links => id links (first title wins on legacy duplicates).
  const titleToId = new Map<string, string>();
  for (const n of notes) {
    if (!titleToId.has(n.title)) titleToId.set(n.title, n.id);
  }
  let droppedLinks = 0;
  const rawsById = new Map(raws.map((n) => [n.id, n]));
  for (const n of notes) {
    const legacy = rawsById.get(n.id)?.linked;
    if (!Array.isArray(legacy)) continue;
    const ids: string[] = [];
    for (const t of legacy) {
      const id = titleToId.get(t);
      if (id && id !== n.id && !ids.includes(id)) ids.push(id);
      else if (!id) droppedLinks++;
    }
    n.linkedIds = [...n.linkedIds, ...ids.filter((id) => !n.linkedIds.includes(id))];
  }
  // Drop dangling ids left by any path.
  for (const n of notes) {
    const before = n.linkedIds.length;
    n.linkedIds = n.linkedIds.filter((id) => id !== n.id && byId.has(id));
    droppedLinks += before - n.linkedIds.length;
  }

  const tasks = sanitize(raw.tasks, isTaskItem);
  const trashTasks = sanitize(raw.trashTasks, isTaskItem);
  const prompts = sanitize(raw.prompts, isPromptSave);
  droppedItems += tasks.dropped + trashTasks.dropped + prompts.dropped;

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_TOP_FIELDS.has(k)) rest[k] = v;
  }

  return {
    store: {
      notes,
      tasks: tasks.list,
      trash: cleanTrash.map(conv),
      graphs,
      trashTasks: trashTasks.list,
      prompts: prompts.list,
      customTpls: convertTpls(raw.customTpls),
      activeId: typeof raw.activeId === 'string' ? raw.activeId : '',
    },
    droppedLinks,
    droppedItems,
    rest,
  };
}

/** A loaded payload plus its migration report. Callers surface droppedLinks
 * explicitly (App toasts the session max once); no module-global counters. */
export interface LoadedStore {
  store: Store;
  droppedLinks: number;
}

function readStoreResult(get: (key: string) => string | null, key: string): LoadResult {
  const empty = { droppedLinks: 0, droppedItems: 0 };
  let rawStr: string | null;
  try {
    rawStr = get(key);
  } catch {
    return { status: 'corrupt', ...empty };
  }
  if (!rawStr) return { status: 'absent', ...empty };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStr);
  } catch {
    return { status: 'corrupt', raw: rawStr, ...empty };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'corrupt', raw: rawStr, ...empty };
  }
  const loose = parsed as LooseStore;
  if (!Array.isArray(loose.notes) || !Array.isArray(loose.tasks)) {
    return { status: 'corrupt', raw: rawStr, ...empty };
  }
  if (typeof loose.schemaVersion === 'number' && loose.schemaVersion > SCHEMA_VERSION) {
    return { status: 'future', raw: rawStr, ...empty };
  }
  try {
    const m = migrate(loose);
    return {
      status: 'ok',
      store: m.store,
      droppedLinks: m.droppedLinks,
      droppedItems: m.droppedItems,
      rest: m.rest,
    };
  } catch {
    return { status: 'corrupt', raw: rawStr, ...empty };
  }
}

/** Full load result: ok/absent/corrupt/future with raw payload for backup and export. */
export function loadStoreResult(profileId?: string, storage?: Pick<StoreStorage, 'getItem'>): LoadResult {
  const get = storage?.getItem.bind(storage) ?? window.localStorage.getItem.bind(window.localStorage);
  return readStoreResult(get, profileId ? storeKeyFor(profileId) : LEGACY_STORE_KEY);
}

/** Load a profile store; without profileId reads the legacy single-store key (App path until profiles land). */
export function loadStore(profileId?: string, storage?: Pick<StoreStorage, 'getItem'>): LoadedStore | null {
  try {
    const r = loadStoreResult(profileId, storage);
    if (r.status !== 'ok' || !r.store) return null;
    return { store: r.store, droppedLinks: r.droppedLinks };
  } catch {
    return null;
  }
}

/** Save a profile store; without profileId writes the legacy single-store key.
 * Returns false instead of throwing when the write fails (quota, privacy
 * mode) so the caller can surface it; callers that ignore the result keep
 * the old fire-and-forget behavior.
 * opts.status 'future' forbids the write (newer data must never be stamped
 * down to the current version); opts.rest carries unknown fields back. */
export function saveStore(
  s: Store,
  profileId?: string,
  storage?: StoreStorage,
  opts?: { status?: LoadStatus; rest?: Record<string, unknown> },
): boolean {
  if (opts?.status === 'future') return false;
  try {
    const set = storage?.setItem.bind(storage) ?? window.localStorage.setItem.bind(window.localStorage);
    set(
      profileId ? storeKeyFor(profileId) : LEGACY_STORE_KEY,
      JSON.stringify({ ...(opts?.rest ?? {}), ...s, schemaVersion: SCHEMA_VERSION }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Read the pre-profiles store for one-time migration into the default profile.
 * Pure read: the caller saves the result under the profile key and removes the legacy key. */
export function readLegacyStore(storage?: Pick<StoreStorage, 'getItem'>): LoadedStore | null {
  return loadStore(undefined, storage);
}

/** Notes with no outgoing links that nobody references. */
export function unlinkedNotes(notes: Note[]): Note[] {
  const referenced = new Set<string>();
  for (const n of notes) for (const id of n.linkedIds) referenced.add(id);
  return notes.filter((n) => n.linkedIds.length === 0 && !referenced.has(n.id));
}

/** Dangling link ids (should only occur in pre-migration or hand-edited stores). */
export function brokenIds(notes: Note[]): { id: string; usedIn: number }[] {
  const ids = new Set(notes.map((n) => n.id));
  const use = new Map<string, number>();
  for (const n of notes) {
    for (const id of n.linkedIds) {
      if (id !== n.id && !ids.has(id)) use.set(id, (use.get(id) ?? 0) + 1);
    }
  }
  return [...use.entries()].map(([id, usedIn]) => ({ id, usedIn }));
}

/**
 * Append prompt text to a note: pure and unit-tested.
 * Handles both Tiptap JSON docs and legacy HTML strings (escaped).
 */
export function appendPromptText(
  content: Note['content'],
  prevText: string,
  text: string,
): { content: Note['content']; text: string } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nextText = prevText ? `${prevText}\n${text}` : text;
  // UX-02: a paragraph collapses line breaks and indents; multi-line text
  // (code, queries) goes in verbatim as a code block.
  const multi = text.includes('\n');
  if (typeof content === 'string') {
    return { content: multi ? `${content}<pre><code>${esc(text)}</code></pre>` : `${content}<p>${esc(text)}</p>`, text: nextText };
  }
  const doc = content as JSONContent;
  const block: JSONContent = { type: multi ? 'codeBlock' : 'paragraph', content: [{ type: 'text', text }] };
  return { content: { ...doc, content: [...(doc.content ?? []), block] }, text: nextText };
}

/**
 * Task list pipeline order: status filter first, then text search.
 * Shared by TasksPage so the order is unit-tested in one place.
 */
export function filterTasks(tasks: TaskItem[], filter: "active" | "done" | "all", q: string): TaskItem[] {
  const byStatus = tasks.filter((t) => (filter === "all" ? true : filter === "done" ? t.done : !t.done));
  const needle = q.trim().toLowerCase();
  if (!needle) return byStatus;
  return byStatus.filter((t) => `${t.text} ${t.desc ?? ""}`.toLowerCase().includes(needle));
}
