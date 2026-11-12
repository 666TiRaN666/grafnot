// Mutation self-test for check-arch.cjs: tiny fixture projects in Temp, one
// per rule, each must fail with that rule; the clean one and the allowed
// exceptions must pass. Run: node scripts/check-arch.selftest.cjs
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const checker = path.join(__dirname, 'check-arch.cjs');
const base = path.join(os.tmpdir(), 'opencode', 'arch-selftest');

// A clean module pair: one export, used by the other file; one used class.
const clean = {
  'lib.ts': 'export function helper(): number { return 1; }\n',
  'View.tsx': "import { helper } from './lib';\nexport function View() { return <div className=\"box\">{helper()}</div>; }\nexport const usedElsewhere = 1;\n",
  'main.tsx': "import { View, usedElsewhere } from './View';\nconsole.log(View, usedElsewhere);\n",
  'app.css': '.box { z-index: 5; }\n',
};

const cases = [
  ['clean', {}, 0, /check-arch OK/],
  ['allowed: storage module, local stacking', { 'prefs.ts': "export const k = 'x';\nexport function readIt() { return localStorage.getItem(k); }\n", 'main.tsx': "import { View, usedElsewhere } from './View';\nimport { readIt } from './prefs';\nconsole.log(View, usedElsewhere, readIt);\n" }, 0, /check-arch OK/],
  ['storage', { 'Comp.tsx': "export function Comp() { return localStorage.getItem('x'); }\nconsole.log(Comp);\n" }, 1, /^storage: Comp\.tsx:1/m],
  ['page-keys', { 'Keys.tsx': "export function on(t: HTMLElement) { return !!t.closest(\"input, textarea, select, [contenteditable]\"); }\nconsole.log(on);\n" }, 1, /^page-keys: Keys\.tsx:1/m],
  ['search', { 'Find.ts': 'export function find(a: string, q: string) { return a.toLowerCase().includes(q); }\nconsole.log(find);\n' }, 1, /^search: Find\.ts:1/m],
  ['layers', { 'app.css': '.box { z-index: 50; }\n' }, 1, /^layers: app\.css:1/m],
  ['ui-boundary', { 'ui/useThing.ts': "import { helper } from '../lib';\nexport function useThing() { return helper(); }\n", 'main.tsx': "import { View, usedElsewhere } from './View';\nimport { useThing } from './ui/useThing';\nconsole.log(View, usedElsewhere, useThing);\n" }, 1, /^ui-boundary: ui\/useThing\.ts:1/m],
  ['dead-css', { 'app.css': '.box { z-index: 5; }\n.ghost { color: red; }\n' }, 1, /^dead-css: app\.css:0 — \.ghost/m],
  ['dead-export', { 'lib.ts': 'export function helper(): number { return 1; }\nexport function lonely(): number { return 2; }\n' }, 1, /^dead-export: lib\.ts:2 — lonely/m],
];

const failures = [];
for (const [name, override, wantExit, wantRe] of cases) {
  const dir = path.join(base, name.replace(/[^\w-]+/g, '_'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const [f, text] of Object.entries({ ...clean, ...override })) {
    fs.mkdirSync(path.dirname(path.join(dir, 'src', f)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', f), text, 'utf8');
  }
  let exit = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [checker, '--root', dir], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    exit = e.status ?? 1;
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  if (exit !== wantExit || !wantRe.test(out)) failures.push(`${name}: exit ${exit} (want ${wantExit}), output: ${out.trim().split('\n')[0]}`);
}
fs.rmSync(base, { recursive: true, force: true });
if (failures.length) {
  for (const f of failures) console.log('FAIL ' + f);
  console.log(`arch selftest: ${cases.length - failures.length}/${cases.length} passed`);
  process.exit(1);
}
console.log(`arch selftest OK (${cases.length} cases)`);
