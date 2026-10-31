import {
  DAY_START_HOUR,
  DAY_TICKS,
  MAP_SIZE,
  NEEDS,
  PAWN_COUNT,
  START_BERRIES,
  BUSH_MAX_BERRIES,
  BUSH_REGROW_TICKS,
  THINK_COOLDOWN,
} from './balance';
import { ItemStore, type ItemKind } from './items';
import {
  Layer,
  WORK_JOB_KINDS,
  cancelJob,
  planCritical,
  planGoto,
  planUrgent,
  planWork,
  runJob,
  startJob,
  type LayerId,
  type WorkType,
} from './jobs';
import { GameMap, Terrain, generateMap } from './map';
import { createPawn, type Pawn } from './pawn';
import { Rng } from './rng';

export type Designation = 'chop' | 'mine';
export type Order = 'chop' | 'mine' | 'zone' | 'erase';

export interface WorldOptions {
  pawnCount?: number;
  /** false — поселенцы сами не выбирают задачи (для тестов движения). */
  ai?: boolean;
  /** false — без стартовых ягод. */
  startItems?: boolean;
}

const PAWN_DEFS = [
  { name: 'Аня', color: '#E8A33D' },
  { name: 'Борис', color: '#5AA9E6' },
  { name: 'Вера', color: '#C58BE0' },
  { name: 'Глеб', color: '#8FBF5A' },
] as const;
const START_OFFSETS: readonly (readonly [number, number])[] = [[0, 0], [-1, 1], [1, 1], [0, -1]];

export class World {
  readonly map: GameMap;
  readonly items: ItemStore;
  readonly pawns: Pawn[] = [];
  /** Приказы «рубить» и «добывать» по индексу клетки. */
  readonly designations = new Map<number, Designation>();
  /** Клетки склад-зоны. */
  readonly zone = new Set<number>();
  /** Клетки, у которых сменилась местность, — рендер перерисует их. */
  readonly dirty: number[] = [];
  tickCount = 0;
  private readonly ai: boolean;
  private readonly reservations = new Map<number, number>();

  constructor(
    readonly seed: number,
    opts: WorldOptions = {},
  ) {
    this.ai = opts.ai ?? true;
    this.map = generateMap(seed);
    this.items = new ItemStore(this.map);
    const rng = new Rng(seed ^ 0xa11ce);
    const c = Math.floor(MAP_SIZE / 2);
    const count = Math.min(opts.pawnCount ?? PAWN_COUNT, PAWN_DEFS.length);
    for (let i = 0; i < count; i++) {
      const def = PAWN_DEFS[i]!;
      const [ox, oy] = START_OFFSETS[i]!;
      this.pawns.push(createPawn(i, def.name, def.color, c + ox, c + oy, rng));
    }
    if (opts.startItems ?? true) this.items.drop('berries', START_BERRIES, c, c - 2);
  }

  // ---------- резервирование ----------

  private key(layer: LayerId, idx: number): number {
    return idx * 4 + layer;
  }

  isFree(layer: LayerId, idx: number, pawnId: number): boolean {
    const owner = this.reservations.get(this.key(layer, idx));
    return owner === undefined || owner === pawnId;
  }

  reserve(layer: LayerId, idx: number, pawnId: number): void {
    this.reservations.set(this.key(layer, idx), pawnId);
  }

  release(layer: LayerId, idx: number, pawnId: number): void {
    const k = this.key(layer, idx);
    if (this.reservations.get(k) === pawnId) this.reservations.delete(k);
  }

  releaseAll(pawnId: number): void {
    for (const [k, owner] of this.reservations) if (owner === pawnId) this.reservations.delete(k);
  }

  markDirty(idx: number): void {
    this.dirty.push(idx);
  }

  // ---------- команды игрока ----------

  /** Приказ «иди сюда». Возвращает false, если цель непроходима или недостижима. */
  moveTo(pawnId: number, x: number, y: number): boolean {
    const pawn = this.pawns[pawnId];
    if (!pawn) return false;
    const plan = planGoto(this, pawn, x, y);
    if (!plan) return false;
    startJob(this, pawn, plan);
    return true;
  }

  setPriority(pawnId: number, work: WorkType, value: number): void {
    const pawn = this.pawns[pawnId];
    if (pawn) pawn.priorities[work] = Math.max(0, Math.min(4, Math.round(value)));
  }

  /** Применяет приказ к прямоугольнику клеток (границы включительно). Возвращает число изменённых клеток. */
  applyOrder(order: Order, x0: number, y0: number, x1: number, y1: number): number {
    const w = this.map.width;
    let changed = 0;
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.map.height - 1, Math.max(y0, y1)); y++) {
      for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(w - 1, Math.max(x0, x1)); x++) {
        const idx = y * w + x;
        const t = this.map.get(x, y);
        if (order === 'chop') {
          if (t === Terrain.Tree && !this.designations.has(idx)) {
            this.designations.set(idx, 'chop');
            changed++;
          }
        } else if (order === 'mine') {
          if (t === Terrain.Stone && !this.designations.has(idx)) {
            this.designations.set(idx, 'mine');
            changed++;
          }
        } else if (order === 'zone') {
          if (this.map.isPassable(x, y) && !this.zone.has(idx)) {
            this.zone.add(idx);
            changed++;
          }
        } else {
          if (this.designations.delete(idx) || this.zone.delete(idx)) changed++;
        }
      }
    }
    return changed;
  }

  // ---------- запросы ----------

  /** Ягод на карте: на земле, на складе и в руках. */
  totalBerries(): number {
    let n = this.items.total('berries');
    for (const p of this.pawns) if (p.carrying?.kind === 'berries') n += p.carrying.count;
    return n;
  }

  /** Запасы на складе (в клетках склад-зоны). */
  stockpile(): Record<ItemKind, number> {
    const inZone = (idx: number) => this.zone.has(idx);
    return {
      wood: this.items.total('wood', inZone),
      stone: this.items.total('stone', inZone),
      berries: this.items.total('berries', inZone),
    };
  }

  /** Есть предметы вне склада, а склада нет совсем. */
  get needsZone(): boolean {
    return this.zone.size === 0 && this.items.stacks.size > 0;
  }

  // ---------- тик ----------

  tick(): void {
    this.tickCount++;
    for (const b of this.map.bushes.values()) {
      if (b.berries < BUSH_MAX_BERRIES && --b.regrow <= 0) {
        b.berries++;
        b.regrow = BUSH_REGROW_TICKS;
      }
    }
    for (const p of this.pawns) {
      p.prevX = p.x;
      p.prevY = p.y;
      this.updateNeeds(p);
      if (this.ai) this.think(p);
      runJob(this, p);
    }
  }

  private updateNeeds(p: Pawn): void {
    const n = p.needs;
    const perTick = (perDay: number) => perDay / DAY_TICKS;
    const job = p.job;
    const sleeping = job?.kind === 'sleep' && job.phase === 'act';
    const relaxing = job?.kind === 'relax' && job.phase === 'act';
    const working = job !== null && WORK_JOB_KINDS.has(job.kind);

    n.food = Math.max(0, n.food - perTick(NEEDS.foodPerDay));
    n.sleep = sleeping
      ? Math.min(100, n.sleep + perTick(NEEDS.sleepRestorePerDay))
      : Math.max(0, n.sleep - perTick(NEEDS.sleepPerDay));
    if (relaxing) n.rest = Math.min(100, n.rest + perTick(NEEDS.relaxRestorePerDay));
    else if (working) n.rest = Math.max(0, n.rest - perTick(NEEDS.restWorkPerDay));
    else n.rest = Math.min(100, n.rest + perTick(NEEDS.restIdlePerDay));
  }

  private think(p: Pawn): void {
    if (p.job === null) {
      if (p.thinkCooldown > 0) {
        p.thinkCooldown--;
        return;
      }
      const plan = planUrgent(this, p) ?? planWork(this, p);
      if (plan) startJob(this, p, plan);
      else p.thinkCooldown = THINK_COOLDOWN;
      return;
    }
    if (!WORK_JOB_KINDS.has(p.job.kind)) return;
    if (--p.thinkCooldown > 0) return;
    p.thinkCooldown = THINK_COOLDOWN;
    const plan = planCritical(this, p);
    if (plan) startJob(this, p, plan);
  }

  /** Для отладки: сбросить задачу поселенца. */
  stopJob(pawnId: number): void {
    const p = this.pawns[pawnId];
    if (p) cancelJob(this, p);
  }
}

export interface GameTime {
  day: number;
  hour: number;
  minute: number;
}

/** Игровое время по номеру тика. День 1 начинается в DAY_START_HOUR. */
export function gameTime(tick: number): GameTime {
  const day = Math.floor(tick / DAY_TICKS) + 1;
  const minutesIntoDay = Math.floor(((tick % DAY_TICKS) / DAY_TICKS) * 24 * 60);
  const total = minutesIntoDay + DAY_START_HOUR * 60;
  const wrapped = total % (24 * 60);
  return {
    day: day + Math.floor(total / (24 * 60)),
    hour: Math.floor(wrapped / 60),
    minute: wrapped % 60,
  };
}

export { Layer };
