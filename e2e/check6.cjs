// E2E entry (npm run e2e). Groups run in this order on one shared main page;
// each group seeds its own state. GROUPS=a,b runs a subset; sizes: harness.cjs GROUP_SIZES.
const { run } = require('./harness.cjs');

const ORDER = [
  'G0-boot',
  'G1-adopt-clean',
  'G2-editor',
  'G3-linkcalc',
  'G4-story',
  'G5-prompt',
  'G6-tasks',
  'G7-lists',
  'G8-mobile',
  'G9-profiles',
  'G10-p27',
  'G12-blocked',
  'G11-selftest',
  'G13-error',
  'G14-savefail',
  'G15-twotab',
  'G30-rest',
  'G31-registry-sync',
  'G32-registry-read',
  'G16-registry',
  'G17-adoption',
  'G18-shell',
  'G19-notes',
  'G20-plan',
  'G21-week',
  'G22-lib',
  'G23-wb',
  'G24-img',
  'G25-builder',
  'G26-map',
  'G27-mob',
  'G28-keys',
  'G29-kpi',
  'G33-identity',
  'G34-trash',
  'G35-rollout',
];

run(ORDER).catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
