import type { AIModel } from './data';

export interface ModelStat {
  /** Share of generations where the model renders the tag acceptably, 0-100. */
  rate: number;
  /** Generations this rate was computed from. */
  samples: number;
}

export interface TagEntry {
  tag: string;
  perModel: Record<AIModel, ModelStat>;
}

/**
 * Bundled SAMPLE dictionary, not measured telemetry.
 * Values below are illustrative placeholders so the UI works fully offline;
 * replace this file with measured per-model stats to make rates real.
 * Bump DATASET_VERSION every time the table is regenerated.
 */
export const DATASET_VERSION = '1.0.0-sample';
export const GENERATED_AT = '2026-09-15';
export const DATASET_SOURCE =
  'Bundled illustrative sample. No live update pipeline exists by design; see README.';

export const TAG_DATA: TagEntry[] = [
  { tag: 'blue eyes', perModel: { Pony: { rate: 95, samples: 12400 }, SDXL: { rate: 88, samples: 8600 }, Flux: { rate: 97, samples: 15200 } } },
  { tag: 'green eyes', perModel: { Pony: { rate: 93, samples: 9800 }, SDXL: { rate: 85, samples: 7200 }, Flux: { rate: 96, samples: 13100 } } },
  { tag: 'red eyes', perModel: { Pony: { rate: 90, samples: 7600 }, SDXL: { rate: 72, samples: 4100 }, Flux: { rate: 91, samples: 8900 } } },
  { tag: 'blue hair', perModel: { Pony: { rate: 92, samples: 11200 }, SDXL: { rate: 70, samples: 5300 }, Flux: { rate: 96, samples: 14000 } } },
  { tag: 'long hair', perModel: { Pony: { rate: 94, samples: 15000 }, SDXL: { rate: 89, samples: 11000 }, Flux: { rate: 97, samples: 16200 } } },
  { tag: 'short hair', perModel: { Pony: { rate: 91, samples: 10800 }, SDXL: { rate: 87, samples: 9600 }, Flux: { rate: 94, samples: 12100 } } },
  { tag: 'blonde hair', perModel: { Pony: { rate: 93, samples: 13100 }, SDXL: { rate: 90, samples: 10500 }, Flux: { rate: 95, samples: 13800 } } },
  { tag: 'black hair', perModel: { Pony: { rate: 92, samples: 12000 }, SDXL: { rate: 88, samples: 9900 }, Flux: { rate: 95, samples: 12900 } } },
  { tag: 'blue dress', perModel: { Pony: { rate: 88, samples: 6400 }, SDXL: { rate: 93, samples: 7800 }, Flux: { rate: 90, samples: 8100 } } },
  { tag: 'school uniform', perModel: { Pony: { rate: 91, samples: 8900 }, SDXL: { rate: 76, samples: 4500 }, Flux: { rate: 89, samples: 7300 } } },
  { tag: 't-shirt', perModel: { Pony: { rate: 89, samples: 9200 }, SDXL: { rate: 91, samples: 10100 }, Flux: { rate: 93, samples: 11000 } } },
  { tag: 'jacket', perModel: { Pony: { rate: 87, samples: 7100 }, SDXL: { rate: 89, samples: 8300 }, Flux: { rate: 90, samples: 8700 } } },
  { tag: 'standing', perModel: { Pony: { rate: 90, samples: 13500 }, SDXL: { rate: 92, samples: 12800 }, Flux: { rate: 94, samples: 14100 } } },
  { tag: 'sitting', perModel: { Pony: { rate: 89, samples: 11900 }, SDXL: { rate: 90, samples: 11400 }, Flux: { rate: 93, samples: 12600 } } },
  { tag: 'smile', perModel: { Pony: { rate: 92, samples: 14200 }, SDXL: { rate: 91, samples: 13000 }, Flux: { rate: 95, samples: 15000 } } },
  { tag: 'looking at viewer', perModel: { Pony: { rate: 93, samples: 13800 }, SDXL: { rate: 86, samples: 8200 }, Flux: { rate: 92, samples: 11900 } } },
  { tag: 'blue background', perModel: { Pony: { rate: 86, samples: 5800 }, SDXL: { rate: 90, samples: 7600 }, Flux: { rate: 89, samples: 7200 } } },
  { tag: 'sunset', perModel: { Pony: { rate: 88, samples: 6900 }, SDXL: { rate: 91, samples: 8400 }, Flux: { rate: 93, samples: 9100 } } },
  { tag: 'city', perModel: { Pony: { rate: 85, samples: 6100 }, SDXL: { rate: 89, samples: 7900 }, Flux: { rate: 90, samples: 8300 } } },
  { tag: 'forest', perModel: { Pony: { rate: 86, samples: 5900 }, SDXL: { rate: 88, samples: 7400 }, Flux: { rate: 91, samples: 8600 } } },
  { tag: 'soft lighting', perModel: { Pony: { rate: 87, samples: 6300 }, SDXL: { rate: 92, samples: 8800 }, Flux: { rate: 94, samples: 9300 } } },
  { tag: 'cinematic lighting', perModel: { Pony: { rate: 84, samples: 5200 }, SDXL: { rate: 90, samples: 8100 }, Flux: { rate: 92, samples: 8900 } } },
  { tag: 'anime', perModel: { Pony: { rate: 94, samples: 16000 }, SDXL: { rate: 82, samples: 6800 }, Flux: { rate: 88, samples: 7900 } } },
  { tag: 'photorealistic', perModel: { Pony: { rate: 70, samples: 3400 }, SDXL: { rate: 93, samples: 9200 }, Flux: { rate: 95, samples: 10100 } } },
  { tag: 'oil painting', perModel: { Pony: { rate: 78, samples: 4100 }, SDXL: { rate: 89, samples: 7700 }, Flux: { rate: 90, samples: 8000 } } },
  { tag: 'sketch', perModel: { Pony: { rate: 85, samples: 5600 }, SDXL: { rate: 84, samples: 6100 }, Flux: { rate: 87, samples: 6600 } } },
  { tag: 'blush', perModel: { Pony: { rate: 91, samples: 10500 }, SDXL: { rate: 83, samples: 5900 }, Flux: { rate: 90, samples: 8800 } } },
  { tag: 'animal ears', perModel: { Pony: { rate: 92, samples: 9800 }, SDXL: { rate: 68, samples: 3200 }, Flux: { rate: 85, samples: 6100 } } },
  { tag: 'glasses', perModel: { Pony: { rate: 89, samples: 8700 }, SDXL: { rate: 87, samples: 7900 }, Flux: { rate: 91, samples: 9000 } } },
  { tag: 'hat', perModel: { Pony: { rate: 88, samples: 7600 }, SDXL: { rate: 86, samples: 7100 }, Flux: { rate: 89, samples: 8000 } } },
  { tag: 'blue skin', perModel: { Pony: { rate: 12, samples: 180 }, SDXL: { rate: 45, samples: 900 }, Flux: { rate: 78, samples: 3400 } } },
  { tag: 'dark skin', perModel: { Pony: { rate: 64, samples: 2800 }, SDXL: { rate: 71, samples: 3900 }, Flux: { rate: 88, samples: 7200 } } },
  { tag: 'hands', perModel: { Pony: { rate: 58, samples: 2100 }, SDXL: { rate: 62, samples: 2600 }, Flux: { rate: 81, samples: 5400 } } },
  { tag: 'text', perModel: { Pony: { rate: 35, samples: 700 }, SDXL: { rate: 52, samples: 1500 }, Flux: { rate: 76, samples: 3100 } } },
  { tag: 'watermark', perModel: { Pony: { rate: 22, samples: 400 }, SDXL: { rate: 30, samples: 600 }, Flux: { rate: 41, samples: 900 } } },
  { tag: 'logo', perModel: { Pony: { rate: 25, samples: 450 }, SDXL: { rate: 38, samples: 800 }, Flux: { rate: 55, samples: 1400 } } },
  { tag: 'cat', perModel: { Pony: { rate: 90, samples: 9900 }, SDXL: { rate: 88, samples: 8600 }, Flux: { rate: 93, samples: 10200 } } },
  { tag: 'flowers', perModel: { Pony: { rate: 87, samples: 7300 }, SDXL: { rate: 89, samples: 8100 }, Flux: { rate: 92, samples: 8800 } } },
  { tag: 'night', perModel: { Pony: { rate: 86, samples: 6800 }, SDXL: { rate: 90, samples: 8200 }, Flux: { rate: 92, samples: 9000 } } },
  { tag: 'rain', perModel: { Pony: { rate: 84, samples: 5400 }, SDXL: { rate: 87, samples: 7000 }, Flux: { rate: 90, samples: 7900 } } },
  { tag: 'portrait', perModel: { Pony: { rate: 91, samples: 11500 }, SDXL: { rate: 92, samples: 10900 }, Flux: { rate: 94, samples: 12100 } } },
  { tag: 'solo', perModel: { Pony: { rate: 93, samples: 14800 }, SDXL: { rate: 90, samples: 11200 }, Flux: { rate: 94, samples: 13000 } } },
  { tag: '1girl', perModel: { Pony: { rate: 95, samples: 17000 }, SDXL: { rate: 88, samples: 9100 }, Flux: { rate: 90, samples: 9800 } } },
  { tag: 'masterpiece', perModel: { Pony: { rate: 90, samples: 12500 }, SDXL: { rate: 94, samples: 13300 }, Flux: { rate: 93, samples: 12900 } } },
  { tag: 'best quality', perModel: { Pony: { rate: 89, samples: 11800 }, SDXL: { rate: 93, samples: 12600 }, Flux: { rate: 92, samples: 12200 } } },
  { tag: 'red dress', perModel: { Pony: { rate: 87, samples: 5400 }, SDXL: { rate: 90, samples: 6900 }, Flux: { rate: 89, samples: 7300 } } },
  { tag: 'white shirt', perModel: { Pony: { rate: 88, samples: 6100 }, SDXL: { rate: 90, samples: 7800 }, Flux: { rate: 91, samples: 8200 } } },
  { tag: 'black jacket', perModel: { Pony: { rate: 86, samples: 5900 }, SDXL: { rate: 88, samples: 7300 }, Flux: { rate: 89, samples: 7600 } } },
  { tag: 'running', perModel: { Pony: { rate: 87, samples: 6600 }, SDXL: { rate: 89, samples: 7500 }, Flux: { rate: 91, samples: 8300 } } },
  { tag: 'dancing', perModel: { Pony: { rate: 88, samples: 6200 }, SDXL: { rate: 85, samples: 5800 }, Flux: { rate: 89, samples: 7100 } } },
  { tag: 'reading', perModel: { Pony: { rate: 86, samples: 5700 }, SDXL: { rate: 88, samples: 6900 }, Flux: { rate: 90, samples: 7600 } } },
  { tag: 'mountain', perModel: { Pony: { rate: 85, samples: 5500 }, SDXL: { rate: 89, samples: 7400 }, Flux: { rate: 91, samples: 8100 } } },
  { tag: 'beach', perModel: { Pony: { rate: 86, samples: 6000 }, SDXL: { rate: 90, samples: 7700 }, Flux: { rate: 92, samples: 8400 } } },
  { tag: 'snow', perModel: { Pony: { rate: 85, samples: 5600 }, SDXL: { rate: 89, samples: 7300 }, Flux: { rate: 91, samples: 8000 } } },
  { tag: 'stars', perModel: { Pony: { rate: 87, samples: 6300 }, SDXL: { rate: 90, samples: 7800 }, Flux: { rate: 92, samples: 8600 } } },
  { tag: 'moon', perModel: { Pony: { rate: 86, samples: 6100 }, SDXL: { rate: 89, samples: 7500 }, Flux: { rate: 91, samples: 8300 } } },
  { tag: 'dragon', perModel: { Pony: { rate: 89, samples: 7800 }, SDXL: { rate: 74, samples: 3900 }, Flux: { rate: 86, samples: 6400 } } },
];
