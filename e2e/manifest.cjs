// E2E manifest: how many checks each group owns. Shared by the harness (it
// refuses a run whose count differs) and by the runners (gates, weekday
// matrix), which re-check the child's total against it instead of trusting it.
// No browser imports here: requiring it must stay cheap and side-effect free.

// How many checks run in a full suite. Update together with GROUP_SIZES.
const EXPECTED_CHECKS = 202;

// Per-group check counts. Update together with EXPECTED_CHECKS when adding checks.
const GROUP_SIZES = {
  'G0-boot': 3, 'G1-adopt-clean': 1, 'G2-editor': 8, 'G3-linkcalc': 6,
  'G4-story': 18, 'G5-prompt': 5, 'G6-tasks': 7, 'G7-lists': 3,
  'G8-mobile': 1, 'G9-profiles': 4, 'G10-p27': 5, 'G11-selftest': 1, 'G12-blocked': 4, 'G13-error': 2, 'G14-savefail': 2, 'G15-twotab': 2, 'G16-registry': 2, 'G17-adoption': 4, 'G18-shell': 7, 'G19-notes': 3, 'G20-plan': 7, 'G21-week': 6, 'G22-lib': 4, 'G23-wb': 10, 'G24-img': 10, 'G25-builder': 5, 'G26-map': 5, 'G27-mob': 6, 'G28-keys': 15, 'G29-kpi': 7, 'G30-rest': 3, 'G31-registry-sync': 3, 'G32-registry-read': 2,
  'G33-identity': 17,
  'G34-trash': 3,
  'G35-rollout': 11,
};

/** Parse a GROUPS value ("a,b" or "") into names; empty means a full run. */
function parseGroups(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Checks a run must report: the full suite, or the sum of the named groups (undefined for an unknown group). */
function expectedFor(groupsValue) {
  const names = parseGroups(groupsValue);
  if (names.length === 0) return EXPECTED_CHECKS;
  let n = 0;
  for (const g of names) {
    if (!Object.prototype.hasOwnProperty.call(GROUP_SIZES, g)) return undefined;
    n += GROUP_SIZES[g];
  }
  return n;
}

module.exports = { EXPECTED_CHECKS, GROUP_SIZES, parseGroups, expectedFor };
