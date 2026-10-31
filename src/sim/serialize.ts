import { DEFAULT_PRIORITY, STORY } from './balance';
import type { Blueprint } from './build';
import type { ItemStack } from './items';
import type { LogEntry, Story } from './events';
import { WORK_TYPES } from './jobs';
import type { Bush, Crop } from './map';
import type { Pawn } from './pawn';
import { Rng } from './rng';
import { pickTraits } from './traits';
import { World, type Designation } from './world';

/**
 * Версия формата сохранения. При изменении формата — увеличить и добавить миграцию в `migrate`.
 * 1: этап 2. 2: этап 3a (постройки, пол, огород, посевы, чертежи; ключи резервов ×8).
 * 3: этап 4 (рассказчик, журнал; черты, болезнь, температурные состояния у поселенцев).
 * 4: этап 5a (раны, кровь, смерть у поселенцев).
 * 5: этап 5b (налётчики, тревога, оружие, набеги в рассказчике).
 */
export const SAVE_VERSION = 5;

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
  /** Состояние ГПСЧ симуляции (может отсутствовать в старых сохранениях). */
  rng?: number;
  /** Налётчики, тревога (может отсутствовать в старых сохранениях). */
  enemies?: Pawn[];
  alarm?: boolean;
  alarmAuto?: boolean;
  nextEnemyId?: number;
  /** Гуляют ли праздные (может отсутствовать — тогда да). */
  stroll?: boolean;
  /** Рассказчик и журнал (в сохранениях версии 2 их нет). */
  story?: Story;
  log?: LogEntry[];
  logSeq?: number;
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
      rng: w.rng.getState(),
      stroll: w.stroll,
      enemies: w.enemies,
      alarm: w.alarm,
      alarmAuto: w.alarmAuto,
      nextEnemyId: w.nextEnemyId,
      story: w.story,
      log: w.log,
      logSeq: w.logSeq,
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
    return migrate({ ...migrateV1(raw) });
  }
  if (raw.version === 2) return migrate({ ...raw, version: 3 });
  if (raw.version === 3) return migrate({ ...raw, version: 4 });
  if (raw.version === 4) return { ...raw, version: 5 };
  return raw.version === SAVE_VERSION ? raw : null;
}

/** v1 → v2 (дальше цепочка продолжится в migrate). */
function migrateV1(raw: Record<string, unknown>): Record<string, unknown> {
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
  const w = new World(d.seed, { pawnCount: 0, startItems: false, stroll: d.stroll ?? true });
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
    normalizePawn(p, d.seed);
    w.pawns.push(p);
  }
  if (typeof d.rng === 'number') w.rng.setState(d.rng);
  w.tickCount = d.tick;
  if (d.story) {
    w.story = d.story;
    if (w.story.pending) normalizePawn(w.story.pending.pawn, d.seed);
  } else {
    // сохранение до этапа 4: первое событие — через обычный срок от текущего момента
    w.story.nextEventTick = d.tick + w.rng.int(STORY.firstMin, STORY.firstMax);
  }
  if (d.story) {
    w.story.raid ??= null;
    w.story.raidActive ??= false;
    w.story.raidFled ??= false;
    w.story.raidsDone ??= 0;
    w.story.peaceful ??= false;
  }
  for (const e of d.enemies ?? []) {
    normalizePawn(e, d.seed);
    w.enemies.push(e);
  }
  w.alarm = d.alarm ?? false;
  w.alarmAuto = d.alarmAuto ?? false;
  w.nextEnemyId = d.nextEnemyId ?? w.enemies.length;
  w.log = d.log ?? [];
  w.logSeq = d.logSeq ?? w.log.length;
  return w;
}

/** Поля, появившиеся позже: старым поселенцам даём значения по умолчанию (черты — детерминированно). */
function normalizePawn(p: Pawn, seed: number): void {
  for (const work of WORK_TYPES) p.priorities[work] ??= DEFAULT_PRIORITY;
  p.thoughts ??= [];
  p.mood ??= 50;
  p.breakUntil ??= null;
  p.breakCooldownUntil ??= 0;
  p.ownedBed ??= null;
  p.facing ??= Math.PI / 2;
  p.exposure ??= 'none';
  p.sickUntil ??= 0;
  p.wounds ??= [];
  p.blood ??= 100;
  p.downed ??= false;
  p.dead ??= false;
  p.deathTick ??= 0;
  p.carriedBy ??= null;
  p.buried ??= false;
  p.weapon ??= null;
  p.faction ??= 'colony';
  p.attackCooldown ??= 0;
  p.aiTimer ??= 0;
  p.fleeing ??= false;
  p.traits ??= pickTraits(new Rng((seed ^ ((p.id + 1) * 7919)) >>> 0));
}
