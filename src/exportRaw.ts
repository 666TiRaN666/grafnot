import { SCHEMA_VERSION } from './store';
import type { Store } from './store';

/** Blob download workhorse shared by every raw/memory export button. */
export function downloadBlob(text: string, filename: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    return true;
  } catch {
    return false;
  }
}

/** Backup file name a person recognises: profile and date, e.g.
 * grafnot-Основной-2026-10-31.json (focus group: "…-unsaved.json" scared). */
export function backupFileName(profileName: string, kind: 'current' | 'saved', now = new Date()): string {
  const safe = profileName.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'profile';
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `grafnot-${safe}${kind === 'saved' ? '-saved' : ''}-${d}.json`;
}

/** Profile name for a restored file: the inverse of backupFileName; raw
 * store dumps (grafnot-store-…) carry no name and get the fallback. */
export function importedProfileName(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.json$/i, '').replace(/\s*\(\d+\)$/, '').trim();
  const m = /^grafnot-(.+?)(?:-saved)?-\d{4}-\d{2}-\d{2}$/.exec(base);
  if (m) return m[1].slice(0, 40);
  if (/^grafnot-store(?:-|$)/.test(base) || !base) return fallback;
  return base.slice(0, 40);
}

/** Download a raw store payload kept under a storage key (backup copies,
 * blocked-store export). Single helper for every raw-download button. */
export function exportRaw(key: string, filename = `${key}.json`): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return false;
    return downloadBlob(raw, filename);
  } catch {
    return false;
  }
}

/** Download the live in-memory store (failed-save rescue: storage holds
 * older data, so the key must not be read here). */
export function exportMemory(store: Store, rest?: Record<string, unknown>, filename = 'grafnot-store-unsaved.json'): boolean {
  try {
    return downloadBlob(JSON.stringify({ ...rest, ...store, schemaVersion: SCHEMA_VERSION }), filename);
  } catch {
    return false;
  }
}
