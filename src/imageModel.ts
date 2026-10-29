/** Image prompt constructor model (pure). Tags live in lanes ordered the
 * way a model reads a prompt; each model gets its own syntax, negative
 * prompt and frame parameters. Rendering of the tag list itself stays in
 * promptUtils.renderPrompt (shared with saves and the library). */
import type { AIModel, AspectId, TagCat } from './data';
import { TAG_DATA } from './promptData';
import { renderPrompt } from './promptUtils';
import { stripWeight } from './imageTags';

export const CAT_ORDER: TagCat[] = ['quality', 'subject', 'look', 'outfit', 'pose', 'scene', 'light', 'style', 'camera', 'other'];

/** ~1 MP buckets SDXL/Pony/Flux were trained on; Midjourney takes --ar instead. */
export const ASPECTS: Record<AspectId, [number, number]> = {
  '1:1': [1024, 1024],
  '4:5': [896, 1120],
  '3:4': [896, 1152],
  '2:3': [832, 1216],
  '9:16': [768, 1344],
  '16:9': [1344, 768],
  '3:2': [1216, 832],
};
export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

export const PONY_SCORE = 'score_9, score_8_up, score_7_up';

const DICT = new Map(TAG_DATA.map((t) => [t.tag.toLowerCase(), t.cat]));

/** Common English tag endings for tags outside the dictionary. */
const GUESS: [RegExp, TagCat][] = [
  [/\b(hair|eyes|skin|ears|face|smile)$/, 'look'],
  [/\b(dress|shirt|jacket|uniform|skirt|coat|hat|boots|hoodie|kimono)$/, 'outfit'],
  [/\blighting$|\blight$/, 'light'],
  [/\b(background|sky|room|street|landscape)$/, 'scene'],
  [/\b(shot|close-up|view|angle|body)$/, 'camera'],
  [/\b(style|painting|art|render)$/, 'style'],
];

/** Lane of a tag: the user's choice, else the dictionary, else a guess, else 'other'. */
export function catOf(token: string, overrides: Record<string, TagCat> = {}): TagCat {
  const tag = stripWeight(token).toLowerCase();
  const own = overrides[tag] ?? overrides[stripWeight(token)];
  if (own) return own;
  const known = DICT.get(tag);
  if (known) return known;
  for (const [re, cat] of GUESS) if (re.test(tag)) return cat;
  return 'other';
}

/** Lane order, stable inside a lane: the prompt reads quality → subject → … → camera. */
export function orderTokens(tokens: string[], overrides: Record<string, TagCat> = {}): string[] {
  return tokens
    .map((t, i) => ({ t, i, c: CAT_ORDER.indexOf(catOf(t, overrides)) }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map((x) => x.t);
}

/** Alt+arrows on a chip: swap with the nearest tag of the same lane, or stay. */
export function moveInLane(tokens: string[], index: number, dir: -1 | 1, overrides: Record<string, TagCat> = {}): string[] {
  const token = tokens[index];
  if (token === undefined) return tokens;
  const lane = catOf(token, overrides);
  for (let j = index + dir; j >= 0 && j < tokens.length; j += dir) {
    const other = tokens[j];
    if (other !== undefined && catOf(other, overrides) === lane) {
      const next = [...tokens];
      next[index] = other;
      next[j] = token;
      return next;
    }
  }
  return tokens;
}

export interface ImageSpecLike {
  model: AIModel;
  tokens: string[];
  negative: string[];
  aspect: AspectId;
  ponyScore: boolean;
  tagCats?: Record<string, TagCat>;
}

export interface ImageRender {
  positive: string;
  /** Separate negative prompt; '' when the model has none (Flux) or takes it inline (Midjourney). */
  negative: string;
  negativeSupported: boolean;
  /** Width×height to set in the generator; null when the prompt carries --ar. */
  size: [number, number] | null;
}

export function renderImage(spec: ImageSpecLike): ImageRender {
  const tokens = orderTokens(spec.tokens, spec.tagCats);
  const neg = spec.negative.map((t) => stripWeight(t)).filter(Boolean);
  if (spec.model === 'Midjourney') {
    const body = renderPrompt('Midjourney', tokens);
    const params = [` --ar ${spec.aspect}`, neg.length ? ` --no ${neg.join(', ')}` : ''].join('');
    return { positive: body ? body + params : '', negative: '', negativeSupported: true, size: null };
  }
  const body = renderPrompt(spec.model, tokens);
  const positive = spec.model === 'Pony' && spec.ponyScore && body ? `${PONY_SCORE}, ${body}` : body;
  const supported = spec.model !== 'Flux';
  return { positive, negative: supported ? neg.join(', ') : '', negativeSupported: supported, size: ASPECTS[spec.aspect] };
}
