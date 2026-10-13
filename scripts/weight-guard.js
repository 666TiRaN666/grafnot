// Pure baseline comparison for the weight reporter (W1 fuse, no hard limits).
// Growth above WARN_PCT warns (exit 0), above FAIL_PCT fails (exit 1).
export const WARN_PCT = 15;
export const FAIL_PCT = 50;

export function compareToBaseline(current, baseline) {
  const pct = ((current - baseline) / baseline) * 100;
  if (pct > FAIL_PCT) return { pct, status: 'fail' };
  if (pct > WARN_PCT) return { pct, status: 'warn' };
  return { pct, status: 'ok' };
}
