// Architecture guard (2026-11, docs/Architecture_Audit_2026-11-12.md): each
// rule stops one class of debt the audit found from coming back. Exceptions
// are listed with their reason; a new exception needs one too.
// Usage: node scripts/check-arch.cjs [--root <project dir>]   (exit 1 on a violation)
//        node scripts/check-arch.selftest.cjs                  (mutation self-test)
const fs = require('fs');
const path = require('path');

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');
const isTest = (f) => /\.test\.[cm]?[jt]sx?$/.test(f);
const all = walk(SRC);
const code = all.filter((f) => /\.tsx?$/.test(f) && !isTest(f));
const css = all.filter((f) => f.endsWith('.css'));
const read = (f) => fs.readFileSync(f, 'utf8');
const extra = ['e2e', 'scripts'].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => /\.[cm]?js$/.test(f));

const violations = [];
const report = (rule, file, line, msg) => violations.push(`${rule}: ${rel(file)}:${line} — ${msg}`);
const eachLine = (files, fn) => {
  for (const f of files) read(f).split('\n').forEach((text, i) => fn(f, text, i + 1));
};

// R1 storage: browser storage only in the storage modules. Components use
// prefs.readPref/writePref (prefs) or the store pipeline (data).
const STORAGE_OK = new Set(['store.ts', 'profiles.ts', 'storage/profileBoot.ts', 'prefs.ts', 'listPrefs.ts', 'exportRaw.ts']);
eachLine(code, (f, text, n) => {
  if (!/\b(localStorage|sessionStorage)\b/.test(text) || /^\s*(\/\/|\*|\/\*)/.test(text)) return;
  if (STORAGE_OK.has(rel(f))) return;
  // App.tsx owns the save pipeline: it may hand the storage to the storage
  // modules and touch store keys, never read or write prefs by hand.
  if (rel(f) === 'App.tsx' && (/storeKeyFor\(|LEGACY_STORE_KEY/.test(text) || /window\.localStorage\s*[,)]/.test(text))) return;
  report('storage', f, n, 'direct browser storage: use readPref/writePref (prefs.ts) or the store pipeline');
});

// R2 page keys: the «is this key for the page» rule lives in ui/pageKeys.ts.
eachLine(code, (f, text, n) => {
  if (rel(f) === 'ui/pageKeys.ts') return;
  if (/closest\??\.?\(\s*["'`]input, textarea, select, \[contenteditable\]/.test(text)) {
    report('page-keys', f, n, 'page shortcut guard written by hand: use pageShortcutAllowed / isTypingTarget (ui/pageKeys.ts)');
  }
});

// R3 search: one matching rule for records (textMatch.matchesQuery).
const MATCH_OK = new Map([
  ['textMatch.ts', 'the rule itself'],
  ['imageTags.ts', 'tag completion is a prefix pick, not a record search'],
  ['store.ts', 'legacy filterTasks, store.ts is frozen'],
]);
eachLine(code, (f, text, n) => {
  if (MATCH_OK.has(rel(f))) return;
  if (/\.toLowerCase\(\)\.includes\(/.test(text)) report('search', f, n, 'hand-made text search: use matchesQuery (textMatch.ts)');
});

// R4 layers: overlay z-index comes from the --u-z-* scale (ui/tokens.css).
eachLine(css, (f, text, n) => {
  if (rel(f) === 'ui/tokens.css') return;
  for (const m of text.matchAll(/z-index:\s*(\d+)/g)) {
    if (Number(m[1]) >= 10) report('layers', f, n, `z-index ${m[1]}: use a --u-z-* layer (values under 10 are local stacking only)`);
  }
});

// R7 ui boundary: shared interface mechanisms know nothing about notes, tasks or sections.
eachLine(code, (f, text, n) => {
  if (!rel(f).startsWith('ui/')) return;
  if (/from\s+['"]\.\.\//.test(text)) report('ui-boundary', f, n, 'ui/ imports from outside ui/: shared mechanisms stay domain-free');
});

// R5 dead CSS: every class a stylesheet defines is used somewhere in the code.
const GENERATED = new Set(['is-editor-empty', 'ProseMirror-selectednode', 'selectedCell']); // Tiptap adds these
const codeBlob = code.map(read).join('\n');
for (const f of css) {
  const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...text.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c)));
  for (const c of defined) {
    if (GENERATED.has(c)) continue;
    const used = new RegExp(`[\\s"'\`.{(]${c.replace(/-/g, '\\-')}(?![\\w-])`).test(codeBlob);
    if (!used) report('dead-css', f, 0, `.${c} is defined but no component uses it`);
  }
}

// R6 dead exports: an export nobody imports — not the app, not a test, not a script.
const EXPORT_OK = new Map([['promptData.ts::DATASET_SOURCE', 'provenance of the tag dataset']]);
const everything = [...all.filter((f) => /\.tsx?$/.test(f)), ...extra].map((f) => [f, read(f)]);
for (const f of code) {
  const own = read(f);
  for (const m of own.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|let)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    if (EXPORT_OK.has(`${rel(f)}::${name}`)) continue;
    const word = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    const ownRefs = (own.match(word) || []).length;
    if (ownRefs > 1) continue; // used inside its module
    if (everything.some(([g, text]) => g !== f && word.test(text))) continue;
    report('dead-export', f, own.slice(0, m.index).split('\n').length, `${name} is exported but used nowhere`);
  }
}

if (violations.length) {
  for (const v of violations) console.log(v);
  console.log(`check-arch: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log('check-arch OK (storage, page-keys, search, layers, ui-boundary, dead-css, dead-export)');
