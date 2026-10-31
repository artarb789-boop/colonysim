import { CROP, HERB } from './balance';
import type { Crop } from './map';

export type CropKind = 'rice' | 'herb';

export function kindOfCrop(c: Crop): CropKind {
  return c.kind ?? 'rice';
}

/** Сколько тиков роста нужно до созревания. */
export function growTicksOf(c: Crop): number {
  return kindOfCrop(c) === 'herb' ? HERB.growTicks : CROP.growTicks;
}

export function isMature(c: Crop): boolean {
  return c.growth >= growTicksOf(c);
}
