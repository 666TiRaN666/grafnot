import { listSlots } from "./promptUtils";
import type { LlmTpl } from "./data";

/** Slots without a non-empty default must be filled before copying. */
export function requiredSlots(tpl: Pick<LlmTpl, "body" | "defaults">): string[] {
  return listSlots(tpl.body).filter((s) => !((tpl.defaults[s] ?? "").trim()));
}

/** Save naming: «<шаблон> · <дата>» (S7.5). */
export function buildSaveTitle(tplName: string, dateStr: string): string {
  return `${tplName} · ${dateStr}`;
}
