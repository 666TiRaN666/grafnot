import { listSlots } from "./promptUtils";

export interface TplLint {
  line: number;
  kind: "unclosed" | "duplicate";
  name?: string;
}

/** Smallest free поле_N for [Вставить поле]. */
export function nextFieldName(body: string): string {
  const used = new Set<number>();
  const re = /поле_(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) used.add(Number(m[1]));
  let n = 1;
  while (used.has(n)) n++;
  return `поле_${n}`;
}

/** Inline syntax check, one entry per offending line. */
export function lintTemplate(body: string): TplLint[] {
  const out: TplLint[] = [];
  const seen = new Set<string>();
  body.split("\n").forEach((ln, idx) => {
    const line = idx + 1;
    const opens = (ln.match(/\{\{/g) || []).length;
    const closes = (ln.match(/\}\}/g) || []).length;
    if (opens > closes) out.push({ line, kind: "unclosed" });
    for (const name of listSlots(ln)) {
      if (seen.has(name)) out.push({ line, kind: "duplicate", name });
      else seen.add(name);
    }
  });
  return out;
}
