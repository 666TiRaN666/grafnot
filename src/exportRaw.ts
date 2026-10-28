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

/** Download a raw store payload kept under a storage key (backup copies,
 * blocked-store export). Single helper for every raw-download button. */
export function exportRaw(key: string): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return false;
    return downloadBlob(raw, `${key}.json`);
  } catch {
    return false;
  }
}

/** Download the live in-memory store (failed-save rescue: storage holds
 * older data, so the key must not be read here). */
export function exportMemory(store: Store, rest?: Record<string, unknown>): boolean {
  try {
    return downloadBlob(JSON.stringify({ ...rest, ...store, schemaVersion: SCHEMA_VERSION }), 'grafnot-store-unsaved.json');
  } catch {
    return false;
  }
}
