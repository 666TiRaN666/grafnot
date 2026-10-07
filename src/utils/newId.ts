/** Collision-free id generator: crypto.randomUUID with a per-call counter
 * fallback for runtimes without WebCrypto. The type prefix (n/t/p/ct/g/c)
 * keeps ids human-scannable in storage; ordering still uses `updated`
 * timestamps, which newId deliberately never touches.
 */
let fallbackCounter = 0;

export function newId(prefix: string): string {
  fallbackCounter += 1;
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through to the counter fallback below */
  }
  return `${prefix}${Date.now().toString(36)}x${fallbackCounter.toString(36)}`;
}
