/** W14 (D5): restore a downloaded store file into a NEW profile. Pure:
 * strict nested validation, then the same migrate() the loader uses. A file
 * that fails is rejected whole; nothing is written by this module. */
import { migrate, SCHEMA_VERSION } from './store';
import type { LooseStore, Store } from './store';

export type ImportReason = 'json' | 'shape' | 'future' | 'type' | 'duplicate';
export type ImportResult =
  | { ok: true; store: Store; rest: Record<string, unknown>; report: { notes: number; tasks: number; graphs: number; dropped: number } }
  | { ok: false; reason: ImportReason };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => typeof v === 'string';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const strList = (v: unknown) => Array.isArray(v) && v.every(str);
const optList = (v: unknown, each: (x: unknown) => boolean) => v === undefined || (Array.isArray(v) && v.every(each));

const isCalc = (c: unknown) => isObj(c) && str(c.id) && optStr(c.name) && optStr(c.expr);
const isNote = (n: unknown) =>
  isObj(n) && str(n.id) && n.id !== '' && str(n.title) && optStr(n.text) && optStr(n.notebook) && optStr(n.bodyHtml) &&
  (n.content === undefined || str(n.content) || isObj(n.content)) &&
  (n.linkedIds === undefined || strList(n.linkedIds)) && (n.linked === undefined || strList(n.linked)) &&
  optList(n.calcs, isCalc) && (n.updated === undefined || typeof n.updated === 'number');
const isTask = (t: unknown) =>
  isObj(t) && str(t.id) && str(t.text) && typeof t.done === 'boolean' && optStr(t.desc) && optStr(t.due) && optStr(t.noteId);
const isGraph = (g: unknown) => isObj(g) && str(g.id) && str(g.title) && strList(g.noteIds);
const isPrompt = (p: unknown) => isObj(p) && str(p.id) && str(p.title) && (p.kind === 'image' || p.kind === 'llm');
const isTrashMeta = (v: unknown) =>
  v === undefined || (isObj(v) && Object.values(v).every((m) => isObj(m) && strList(m.incoming) && strList(m.graphs)));

/** After the checks in parseImport, every field migrate() reads is typed;
 * migrate() itself tolerates the optional ones being absent. */
const isLoose = (v: Obj): v is Obj & LooseStore => Array.isArray(v.notes) && Array.isArray(v.tasks);
const ids = (lists: unknown[]) => lists.flatMap((l) => (Array.isArray(l) ? l.map((x) => (x as Obj).id) : []));
const unique = (list: unknown[]) => new Set(list).size === list.length;

export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (!isObj(raw) || !Array.isArray(raw.notes) || !Array.isArray(raw.tasks)) return { ok: false, reason: 'shape' };
  const v = raw.schemaVersion;
  if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 1)) return { ok: false, reason: 'type' };
  if (typeof v === 'number' && v > SCHEMA_VERSION) return { ok: false, reason: 'future' };
  const typed =
    raw.notes.every(isNote) && optList(raw.trash, isNote) && raw.tasks.every(isTask) && optList(raw.trashTasks, isTask) &&
    optList(raw.graphs, isGraph) && optList(raw.prompts, isPrompt) && optList(raw.customTpls, isObj) &&
    isTrashMeta(raw.trashMeta) && optStr(raw.activeId);
  if (!typed) return { ok: false, reason: 'type' };
  if (!unique(ids([raw.notes, raw.trash])) || !unique(ids([raw.tasks, raw.trashTasks])) || !unique(ids([raw.graphs])) || !unique(ids([raw.prompts]))) {
    return { ok: false, reason: 'duplicate' };
  }
  if (!isLoose(raw)) return { ok: false, reason: 'shape' };
  const m = migrate(raw);
  return {
    ok: true,
    store: m.store,
    rest: m.rest,
    report: { notes: m.store.notes.length, tasks: m.store.tasks.length, graphs: m.store.graphs.length, dropped: m.droppedLinks + m.droppedItems },
  };
}

/** Order-insensitive content fingerprint for the read-back round trip. */
export function storeDigest(s: Store): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort({ ...s, activeId: s.activeId ?? '', trashMeta: s.trashMeta ?? {} }));
}
