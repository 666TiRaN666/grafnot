import type { Lang } from "./i18n";
import { tr } from "./i18n";

/**
 * Note formulas (calc blocks): safe arithmetic over named blocks, no eval.
 * Moved out of NotesView (2026-11) so the parser, references between blocks
 * and cycle detection have unit tests apart from the editor.
 */

/** Block names are matched without spaces. */
const normName = (n: string) => n.trim().replace(/\s+/g, "");

/** Safe arithmetic with named variables, no eval. Throws on cycle / unknown names. */
function evalExpr(src: string, blocks: { name: string }[], lookup: (name: string) => number): number {
  const s = src.replace(/\s+/g, "").replace(/,/g, ".");
  const names = blocks
    .map((b) => normName(b.name))
    .filter((n) => n.length > 0)
    .sort((a, b) => b.length - a.length);
  let i = 0;
  function parseExpr(): number {
    let v = parseTerm();
    while (s[i] === "+" || s[i] === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (s[i] === "*" || s[i] === "/" || s[i] === "%") {
      const op = s[i++];
      const r = parseFactor();
      if (op === "*") v *= r;
      else if (op === "/") {
        if (!r) throw new Error("div0");
        v /= r;
      } else v %= r;
    }
    return v;
  }
  function parseFactor(): number {
    const c = s[i];
    if (c === "(") {
      i++;
      const v = parseExpr();
      if (s[i] !== ")") throw new Error("paren");
      i++;
      return v;
    }
    if (c === "-") {
      i++;
      return -parseFactor();
    }
    if (c === "+") {
      i++;
      return parseFactor();
    }
    for (const n of names) {
      if (s.startsWith(n, i)) {
        i += n.length;
        return lookup(n);
      }
    }
    const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      return parseFloat(m[0]);
    }
    const idm = /^[A-Za-zА-Яа-яЁё_]+[A-Za-zА-Яа-яЁё_0-9]*/.exec(s.slice(i));
    throw new Error("unknown:" + (idm ? idm[0] : (c ?? "")));
  }
  if (!s) throw new Error("empty");
  const v = parseExpr();
  if (i !== s.length) throw new Error("end");
  return v;
}

interface CalcLike {
  id: string;
  name: string;
  expr: string;
}

function resolveBlock(id: string, blocks: CalcLike[], memo: Map<string, number>, visiting: Set<string>): number {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  if (visiting.has(id)) throw new Error("cycle");
  const b = blocks.find((x) => x.id === id);
  if (!b) throw new Error("unknown:");
  visiting.add(id);
  try {
    const v = evalExpr(b.expr, blocks, (name) => {
      const t = blocks.find((x) => normName(x.name) === name);
      if (!t) throw new Error("unknown:" + name);
      return resolveBlock(t.id, blocks, memo, visiting);
    });
    memo.set(id, v);
    return v;
  } finally {
    visiting.delete(id);
  }
}

export function calcDisplay(c: CalcLike, blocks: CalcLike[], lang: Lang): { text: string; title: string } {
  if (!c.expr.trim()) return { text: "", title: "" };
  try {
    const v = resolveBlock(c.id, blocks, new Map(), new Set());
    if (!Number.isFinite(v)) return { text: "—", title: "" };
    return { text: "= " + (Math.round(v * 100) / 100).toLocaleString("ru-RU"), title: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "cycle") return { text: "—", title: tr("calcCycle", lang) };
    if (msg.startsWith("unknown:")) return { text: "—", title: tr("calcUnknown", lang) + msg.slice(8) };
    return { text: "—", title: "" };
  }
}
