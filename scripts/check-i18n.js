import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Reports i18n problems in src/i18n.ts against tr() usage across src/.
// Three checks, all exit 1 on failure: missing (a tr('...') literal with no
// dict entry), parity (an entry lacking RU, EN or KZ), dead (a dict entry no
// tr() call consumes). Deliberately not a full parser. It understands exactly
// the shapes used in this codebase: the STR dict is walked as brace-matched
// sections (no indentation assumptions), string literals (including ternaries
// of literals) and tr() calls nested inside template substitutions. Comments
// are stripped first without touching string contents. A regex literal holding
// braces inside a template substitution would confuse the brace matching, so
// keep such constructs out of tr() calls. Dynamic member access is covered by
// DYNAMIC_KEYS below cross-checked against the chips config (never by
// guessing). Never deletes anything. Usage: node scripts/check-i18n.js
// [srcDir] (default: ../src, so `npm run check:i18n` is unchanged).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// S9: the { id, key } chips config died with the legacy page (nothing to
// cross-check anymore). Dynamic tr(c.key) calls are banned: every key must
// appear as a tr("...") literal so the dead-key scan stays exact.
// S12 exception: Settings → Keys renders from the shortcuts registry
// (src/shortcuts.ts), so labelKey: "..." literals there count as usage.

function listFiles(dir, out) {
  out = out || [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      listFiles(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name) && e.name !== "i18n.ts") {
      out.push(p);
    }
  }
  return out;
}

function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\"" || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < src.length) {
        const d = src[i];
        out += d;
        if (d === "\\") {
          if (i + 1 < src.length) out += src[i + 1];
          i += 2;
          continue;
        }
        if (d === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function isIdChar(c) {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

// Skip a single- or double-quoted string starting at src[i]. Returns the
// index just past the closing quote (or the end on unterminated input).
function skipQuoted(src, i, to) {
  const q = src[i];
  i++;
  while (i < to) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i + 1;
    i++;
  }
  return i;
}

// Walk a template literal starting at the opening backtick, collecting keys
// from ${...} spans as code. Returns the index past the closing backtick.
function scanTemplate(src, i, to, used) {
  i++;
  while (i < to) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      let depth = 1;
      const start = i + 2;
      i += 2;
      while (i < to && depth > 0) {
        const d = src[i];
        if (d === "\"" || d === "'") { i = skipQuoted(src, i, to); continue; }
        if (d === "`") { i = scanTemplate(src, i, to, used); continue; }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
      scanRange(src, start, i - 1, used);
      continue;
    }
    i++;
  }
  return i;
}

// Index past a template literal starting at the opening backtick (no key
// collection; substitutions are handled by the caller).
function skipTemplate(src, i, to) {
  i++;
  while (i < to) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") return i + 1;
    if (c === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < to && depth > 0) {
        const d = src[i];
        if (d === "\"" || d === "'") { i = skipQuoted(src, i, to); continue; }
        if (d === "`") { i = skipTemplate(src, i, to); continue; }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

// Collect key-position literals from one key expression. A ternary condition
// is never a key (tr(theme === 'light' ? 'themeIsLight' : ...): 'light' is
// a comparison operand, the branches hold the keys), so conditions are cut
// out recursively; template substitutions are full expressions and recurse.
function collectExprLiterals(src, from, to, used) {
  let depth = 0;
  let q = -1;
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "\"" || c === "'") { i = skipQuoted(src, i, to); continue; }
    if (c === "`") { i = skipTemplate(src, i, to); continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "?" && depth === 0 && src[i + 1] !== "." && src[i + 1] !== "?") { q = i; break; }
    i++;
  }
  if (q >= 0) {
    let qdepth = 0;
    let colon = -1;
    i = q + 1;
    while (i < to) {
      const c = src[i];
      if (c === "\"" || c === "'") { i = skipQuoted(src, i, to); continue; }
      if (c === "`") { i = skipTemplate(src, i, to); continue; }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (depth === 0 && c === "?") {
        if (src[i + 1] === "." || src[i + 1] === "?") { i += 2; continue; }
        qdepth++;
      } else if (depth === 0 && c === ":") {
        if (qdepth === 0) { colon = i; break; }
        qdepth--;
      }
      i++;
    }
    if (colon >= 0) {
      collectExprLiterals(src, q + 1, colon, used);
      collectExprLiterals(src, colon + 1, to, used);
    }
    return;
  }
  i = from;
  while (i < to) {
    const c = src[i];
    if (c === "\"" || c === "'") {
      const qq = c;
      let lit = "";
      i++;
      while (i < to) {
        if (src[i] === "\\") { lit += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === qq) break;
        lit += src[i];
        i++;
      }
      used.add(lit);
      i++;
      continue;
    }
    if (c === "`") {
      i++;
      while (i < to) {
        const d = src[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "`") { i++; break; }
        if (d === "$" && src[i + 1] === "{") {
          let dd = 1;
          const start = i + 2;
          i += 2;
          while (i < to && dd > 0) {
            const e = src[i];
            if (e === "\"" || e === "'") { i = skipQuoted(src, i, to); continue; }
            if (e === "`") { i = skipTemplate(src, i, to); continue; }
            if (e === "{") dd++;
            else if (e === "}") dd--;
            i++;
          }
          collectExprLiterals(src, start, i - 1, used);
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
}

// Collect string literals inside one tr(...) argument span. src[i] is the
// first char after the opening paren. Only the FIRST argument is the key
// expression — later args (lang, params) hold no keys. Returns the index
// past the close.
function scanCall(src, i, to, used) {
  let depth = 1;
  let argStart = i;
  let argIndex = 0;
  const flush = (end) => {
    if (argIndex === 0) collectExprLiterals(src, argStart, end, used);
    argIndex++;
  };
  while (i < to && depth > 0) {
    const c = src[i];
    if (c === "\"" || c === "'") { i = skipQuoted(src, i, to); continue; }
    if (c === "`") { i = skipTemplate(src, i, to); continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { flush(i); i++; break; }
    } else if (c === "," && depth === 1) {
      flush(i);
      argStart = i + 1;
    }
    i++;
  }
  return i;
}

function scanRange(src, from, to, used) {
  let i = from;
  while (i < to) {
    const c = src[i];
    if (c === "\"" || c === "'" || c === "`") {
      if (c === "`") i = scanTemplate(src, i, to, used);
      else i = skipQuoted(src, i, to);
      continue;
    }
    if (c === "t" && src[i + 1] === "r" && !isIdChar(src[i - 1])) {
      let j = i + 2;
      while (j < to && /\s/.test(src[j])) j++;
      if (src[j] === "(") {
        i = scanCall(src, j + 1, to, used);
        continue;
      }
    }
    i++;
  }
}

function collectTrKeys(src) {
  const used = new Set();
  const clean = stripComments(src);
  scanRange(clean, 0, clean.length, used);
  return used;
}

const srcDir = process.argv[2] || root;
const dictPath = join(srcDir, "i18n.ts");
const dict = readFileSync(dictPath, "utf8");

// Section parsing (no indentation assumptions): locate the STR object, walk
// its top-level `key: {...}` entries with brace matching. Gaps between
// entries may only hold commas/whitespace, so unknown shapes fail loudly
// instead of parsing silently wrong.
function matchBrace(src, open) {
  let i = open;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

function parseDict(src) {
  const clean = stripComments(src);
  const decl = /export\s+const\s+STR\b/.exec(clean);
  if (!decl) throw new Error("STR declaration not found in " + dictPath);
  const open = clean.indexOf("{", decl.index);
  const close = matchBrace(clean, open);
  if (close < 0) throw new Error("STR object never closes in " + dictPath);
  const body = clean.slice(open, close);
  const keys = [];
  const langs = new Map();
  const entryRe = /([A-Za-z0-9_]+)\s*:\s*\{/g;
  let pos = 1;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const gap = body.slice(pos, m.index);
    if (!/^[\s,]*$/.test(gap)) throw new Error("unexpected text between dict entries near: " + JSON.stringify(gap.slice(-40)));
    const key = m[1];
    const spanClose = matchBrace(body, m.index + m[0].length - 1);
    if (spanClose < 0) throw new Error("dict entry never closes: " + key);
    const span = body.slice(m.index, spanClose);
    const has = new Set();
    for (const L of ["RU", "EN", "KZ"]) {
      if (new RegExp("(^|[^A-Za-z0-9_$])" + L + "\\s*:").test(span)) has.add(L);
    }
    keys.push(key);
    langs.set(key, has);
    pos = spanClose;
    entryRe.lastIndex = spanClose;
  }
  return { keys, langs };
}

const { keys: declared, langs } = parseDict(dict);
const declaredSet = new Set(declared);

const used = new Set();
for (const f of listFiles(srcDir)) {
  for (const k of collectTrKeys(readFileSync(f, "utf8"))) used.add(k);
}
// S12: registry-driven labels (Settings → Keys from src/shortcuts.ts).
const regPath = join(srcDir, "shortcuts.ts");
if (existsSync(regPath)) {
  for (const m of readFileSync(regPath, "utf8").matchAll(/labelKey\s*:\s*["']([A-Za-z0-9_]+)["']/g)) {
    used.add(m[1]);
  }
}

const missing = [...used].filter((k) => !declaredSet.has(k)).sort();
const gaps = { RU: [], EN: [], KZ: [] };
for (const k of declared) {
  for (const L of ["RU", "EN", "KZ"]) if (!langs.get(k).has(L)) gaps[L].push(k);
}
const dead = declared.filter((k) => !used.has(k));

let failed = false;
if (missing.length > 0) {
  console.log("missing i18n keys (" + missing.length + "): " + missing.join(", "));
  failed = true;
}
for (const L of ["RU", "EN", "KZ"]) {
  if (gaps[L].length > 0) {
    console.log("parity i18n gap: " + L + " missing (" + gaps[L].length + "): " + gaps[L].join(", "));
    failed = true;
  }
}
if (dead.length > 0) {
  console.log("dead i18n keys (" + dead.length + "): " + dead.join(", "));
  failed = true;
}
if (failed) process.exit(1);
console.log("i18n OK (" + declared.length + " keys, " + used.size + " referenced)");
