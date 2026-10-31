import { DEFAULT_PRIORITY } from './balance';
import type { Blueprint } from './build';
import type { ItemStack } from './items';
import { WORK_TYPES } from './jobs';
import type { Bush, Crop } from './map';
import type { Pawn } from './pawn';
import { World, type Designation } from './world';

/**
 * Версия формата сохранения. При изменении формата — увеличить и добавить миграцию в `migrate`.
 * 1: этап 2. 2: этап 3a (постройки, пол, огород, посевы, чертежи; ключи резервов ×8).
 */
export const SAVE_VERSION = 2;

export interface SaveData {
  version: number;
  seed: number;
  tick: number;
  /** Местность строкой цифр: по символу на клетку. */
  cells: string;
  /** Постройки и пол — такие же строки. */
  structure: string;
  floor: string;
  bushes: [number, Bush][];
  crops: [number, Crop][];
  items: [number, ItemStack][];
  designations: [number, Designation][];
  zone: number[];
  garden: number[];
  blueprints: [number, Blueprint][];
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
      structure: Array.from(w.map.structure).join(''),
      floor: Array.from(w.map.floor).join(''),
      bushes: [...w.map.bushes],
      crops: [...w.map.crops],
      items: [...w.items.stacks],
      designations: [...w.designations],
      zone: [...w.zone],
      garden: [...w.garden],
      blueprints: [...w.blueprints],
      reservations: w.exportReservations(),
      pawns: w.pawns,
    }),
  ) as SaveData;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Приводит данные старых версий к текущей; null — если версия неизвестна. */
function migrate(raw: unknown): unknown {
  if (!isObj(raw)) return null;
  if (raw.version === 1) {
    const cells = typeof raw.cells === 'string' ? raw.cells : '';
    const oldReservations = Array.isArray(raw.reservations) ? (raw.reservations as [number, number][]) : [];
    return {
      ...raw,
      version: 2,
      structure: '0'.repeat(cells.length),
      floor: '0'.repeat(cells.length),
      crops: [],
      garden: [],
      blueprints: [],
      // v1: ключ = idx * 4 + слой; v2: idx * 8 + слой
      reservations: oldReservations.map(([k, owner]) => [Math.floor(k / 4) * 8 + (k % 4), owner]),
    };
  }
  return raw.version === SAVE_VERSION ? raw : null;
}

/** Грубая проверка формы; при любом сомнении лучше не загружать, чем сломать игру. */
function isSaveData(x: unknown): x is SaveData {
  if (!isObj(x)) return false;
  return (
    x.version === SAVE_VERSION &&
    typeof x.seed === 'number' &&
    typeof x.tick === 'number' &&
    typeof x.cells === 'string' &&
    typeof x.structure === 'string' &&
    typeof x.floor === 'string' &&
    Array.isArray(x.bushes) &&
    Array.isArray(x.crops) &&
    Array.isArray(x.items) &&
    Array.isArray(x.designations) &&
    Array.isArray(x.zone) &&
    Array.isArray(x.garden) &&
    Array.isArray(x.blueprints) &&
    Array.isArray(x.reservations) &&
    Array.isArray(x.pawns) &&
    x.pawns.every((p) => isObj(p) && typeof p.id === 'number' && isObj(p.needs) && isObj(p.priorities))
  );
}

/** Восстанавливает мир; возвращает null, если данные повреждены или чужой версии. */
export function restoreWorld(data: unknown): World | null {
  let migrated: unknown;
  try {
    migrated = migrate(JSON.parse(JSON.stringify(data)));
  } catch {
    return null;
  }
  if (!isSaveData(migrated)) return null;
  const d = migrated;
  const w = new World(d.seed, { pawnCount: 0, startItems: false });
  const n = w.map.cells.length;
  if (d.cells.length !== n || d.structure.length !== n || d.floor.length !== n) return null;
  for (let i = 0; i < n; i++) {
    w.map.cells[i] = Number(d.cells[i]);
    w.map.structure[i] = Number(d.structure[i]);
    w.map.floor[i] = Number(d.floor[i]);
  }
  w.map.bushes.clear();
  for (const [k, v] of d.bushes) w.map.bushes.set(k, v);
  for (const [k, v] of d.crops) w.map.crops.set(k, v);
  for (const [k, v] of d.items) w.items.stacks.set(k, v);
  for (const [k, v] of d.designations) w.designations.set(k, v);
  for (const k of d.zone) w.zone.add(k);
  for (const k of d.garden) w.garden.add(k);
  for (const [k, v] of d.blueprints) w.blueprints.set(k, v);
  w.importReservations(d.reservations);
  for (const p of d.pawns) {
    for (const work of WORK_TYPES) p.priorities[work] ??= DEFAULT_PRIORITY;
    w.pawns.push(p);
  }
  w.tickCount = d.tick;
  return w;
}
