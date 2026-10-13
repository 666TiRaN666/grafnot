import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Mutation self-test for check-i18n.js (STAGE_10, pruned in S9 with the
// legacy chips config): builds tiny fixture sources in Temp and asserts the
// checker exits as expected with the expected message. Each defective
// fixture must fail, the clean one pass.
// Run: node scripts/check-i18n.selftest.js
const checker = join(dirname(fileURLToPath(import.meta.url)), "check-i18n.js");
const base = join(process.env.TEMP || process.env.TMP || "C:\\Temp", "opencode", "i18n-selftest");

const entry = (k, langs) => `  ${k}: { ${langs.map((L) => `${L}: '${L}-${k}'`).join(", ")} },\n`;
const dictFile = (entries) => `export const STR: Record<string, Record<string, string>> = {\n${entries}};\n`;
const appFile = (keys) => `import { tr } from "./i18n";\nexport function t(lang: string) { return [${keys.map((k) => `tr('${k}', lang)`).join(", ")}].join(" "); }\n`;
const fullDict = (extra = "", dropKZ = []) =>
  dictFile(`  k1: { RU: 'a', EN: 'b'${dropKZ.includes("k1") ? "" : ", KZ: 'c'"} },\n` + extra);

const failures = [];
function runCase(name, files, wantExit, wantRe) {
  const src = join(base, name, "src");
  rmSync(join(base, name), { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(join(src, f), content, "utf8");
  let exit = 0;
  let out = "";
  try {
    out = execFileSync(process.execPath, [checker, src], { encoding: "utf8" });
  } catch (e) {
    exit = e.status ?? 1;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  const ok = exit === wantExit && wantRe.test(out);
  console.log((ok ? "PASS" : "FAIL") + " " + name + " (exit " + exit + ")");
  if (!ok) {
    console.log("--- output ---\n" + out);
    failures.push(name);
  }
}

runCase("clean", { "i18n.ts": fullDict(), "a.tsx": appFile(["k1"]) }, 0, /i18n OK/);
runCase(
  "missing",
  { "i18n.ts": fullDict(), "a.tsx": appFile(["k1", "typo"]) },
  1,
  /missing i18n keys \(1\): typo/,
);
runCase(
  "parity",
  { "i18n.ts": fullDict("", ["k1"]), "a.tsx": appFile(["k1"]) },
  1,
  /parity i18n gap: KZ missing \(1\): k1/,
);
runCase(
  "dead",
  { "i18n.ts": fullDict(entry("kX", ["RU", "EN", "KZ"])), "a.tsx": appFile(["k1"]) },
  1,
  /dead i18n keys \(1\): kX/,
);

rmSync(base, { recursive: true, force: true });
if (failures.length > 0) {
  console.error("selftest FAILED: " + failures.join(", "));
  process.exit(1);
}
console.log("selftest OK (4 cases)");
