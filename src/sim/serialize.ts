import { WORK_TYPES } from './jobs';
import { DEFAULT_PRIORITY } from './balance';
import type { ItemStack } from './items';
import type { Bush } from './map';
import type { Pawn } from './pawn';
import { World, type Designation } from './world';

/** Версия формата сохранения. При изменении формата — увеличить и добавить миграцию. */
export const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  seed: number;
  tick: number;
  /** Местность строкой цифр: по символу на клетку. */
  cells: string;
  bushes: [number, Bush][];
  items: [number, ItemStack][];
  designations: [number, Designation][];
  zone: number[];
  reservations: [number, number][];
  pawns: Pawn[];
}

/** Снимок мира в виде обычных JSON-совместимых данных (без ссылок на живые объекты). */
export function serializeWorld(w: World): SaveData {
  return JSON.parse(
    JSON.stringify({
      version: SAVE_VERSION,
      seed: w.seed,
      tick: w.tickCount,
      cells: Array.from(w.map.cells).join(''),
      bushes: [...w.map.bushes],
      items: [...w.items.stacks],
      designations: [...w.designations],
      zone: [...w.zone],
      reservations: w.exportReservations(),
      pawns: w.pawns,
    }),
  ) as SaveData;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Грубая проверка формы; при любом сомнении лучше не загружать, чем сломать игру. */
function isSaveData(x: unknown): x is SaveData {
  if (!isObj(x)) return false;
  return (
    x.version === SAVE_VERSION &&
    typeof x.seed === 'number' &&
    typeof x.tick === 'number' &&
    typeof x.cells === 'string' &&
    Array.isArray(x.bushes) &&
    Array.isArray(x.items) &&
    Array.isArray(x.designations) &&
    Array.isArray(x.zone) &&
    Array.isArray(x.reservations) &&
    Array.isArray(x.pawns) &&
    x.pawns.every((p) => isObj(p) && typeof p.id === 'number' && isObj(p.needs) && isObj(p.priorities))
  );
}

/** Восстанавливает мир; возвращает null, если данные повреждены или чужой версии. */
export function restoreWorld(data: unknown): World | null {
  if (!isSaveData(data)) return null;
  const d = JSON.parse(JSON.stringify(data)) as SaveData;
  const w = new World(d.seed, { pawnCount: 0, startItems: false });
  if (d.cells.length !== w.map.cells.length) return null;
  for (let i = 0; i < d.cells.length; i++) w.map.cells[i] = Number(d.cells[i]);
  w.map.bushes.clear();
  for (const [k, v] of d.bushes) w.map.bushes.set(k, v);
  for (const [k, v] of d.items) w.items.stacks.set(k, v);
  for (const [k, v] of d.designations) w.designations.set(k, v);
  for (const k of d.zone) w.zone.add(k);
  w.importReservations(d.reservations);
  for (const p of d.pawns) {
    for (const work of WORK_TYPES) p.priorities[work] ??= DEFAULT_PRIORITY;
    w.pawns.push(p);
  }
  w.tickCount = d.tick;
  return w;
}
