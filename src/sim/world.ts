import {
  BED_SLEEP_FACTOR,
  BUILD,
  BUSH_MAX_BERRIES,
  BUSH_REGROW_TICKS,
  CROP,
  DAY_START_HOUR,
  DAY_TICKS,
  MAP_SIZE,
  MOOD,
  NEEDS,
  PAWN_COUNT,
  START_BERRIES,
  THINK_COOLDOWN,
} from './balance';
import {
  STRUCTURE_OF,
  blocksMovement,
  type Blueprint,
  type BuildKind,
} from './build';
import { ItemStore, type ItemKind } from './items';
import {
  Layer,
  WORK_JOB_KINDS,
  cancelJob,
  planCritical,
  planGoto,
  planStepOff,
  planUrgent,
  planWander,
  planWork,
  runJob,
  startJob,
  type LayerId,
  type WorkType,
} from './jobs';
import { GameMap, Structure, Terrain, generateMap } from './map';
import { addThought, computeMood, pruneThoughts } from './mood';
import { createPawn, type Pawn } from './pawn';
import type { Point } from './pathfinding';
import { Rng } from './rng';
import { computeRooms, type RoomMap } from './rooms';

export type Designation = 'chop' | 'mine' | 'deconstruct';
export type Order = 'chop' | 'mine' | 'zone' | 'garden' | 'deconstruct' | 'erase';

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

/** Множитель ключа резервирования (слоёв не больше 8). */
const LAYER_SLOTS = 8;

export class World {
  readonly map: GameMap;
  readonly items: ItemStore;
  readonly pawns: Pawn[] = [];
  /** Приказы «рубить», «добывать», «разобрать» по индексу клетки. */
  readonly designations = new Map<number, Designation>();
  /** Клетки склад-зоны. */
  readonly zone = new Set<number>();
  /** Клетки огорода. */
  readonly garden = new Set<number>();
  /** Чертежи будущих построек по индексу клетки. */
  readonly blueprints = new Map<number, Blueprint>();
  /** Клетки, у которых изменился вид (местность, постройки), — рендер перерисует их. */
  readonly dirty: number[] = [];
  tickCount = 0;
  /** Случайность симуляции (блуждание при срыве); состояние входит в сохранение. */
  readonly rng: Rng;
  private readonly ai: boolean;
  private roomCache: RoomMap | null = null;
  private readonly reservations = new Map<number, number>();

  constructor(
    readonly seed: number,
    opts: WorldOptions = {},
  ) {
    this.ai = opts.ai ?? true;
    this.rng = new Rng(seed ^ 0x77aa);
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
    return idx * LAYER_SLOTS + layer;
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

  exportReservations(): [number, number][] {
    return [...this.reservations];
  }

  importReservations(list: readonly (readonly [number, number])[]): void {
    this.reservations.clear();
    for (const [k, owner] of list) this.reservations.set(k, owner);
  }

  markDirty(idx: number): void {
    this.dirty.push(idx);
  }

  idxOf(x: number, y: number): number {
    return y * this.map.width + x;
  }

  pointOf(idx: number): Point {
    const x = idx % this.map.width;
    return { x, y: (idx - x) / this.map.width };
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

  /** Есть ли в клетке что разбирать: постройка или пол. */
  hasBuilt(idx: number): boolean {
    return this.map.structure[idx] !== Structure.None || this.map.floor[idx] !== 0;
  }

  /** Применяет приказ к прямоугольнику клеток (границы включительно). Возвращает число изменённых клеток. */
  applyOrder(order: Order, x0: number, y0: number, x1: number, y1: number): number {
    const w = this.map.width;
    let changed = 0;
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.map.height - 1, Math.max(y0, y1)); y++) {
      for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(w - 1, Math.max(x0, x1)); x++) {
        const idx = y * w + x;
        const t = this.map.get(x, y);
        const buildable = (t === Terrain.Grass || t === Terrain.Dirt) && this.map.isPassable(x, y);
        switch (order) {
          case 'chop':
            if (t === Terrain.Tree && !this.designations.has(idx)) {
              this.designations.set(idx, 'chop');
              changed++;
            }
            break;
          case 'mine':
            if (t === Terrain.Stone && !this.designations.has(idx)) {
              this.designations.set(idx, 'mine');
              changed++;
            }
            break;
          case 'deconstruct':
            if (this.hasBuilt(idx) && !this.designations.has(idx)) {
              this.designations.set(idx, 'deconstruct');
              changed++;
            }
            break;
          case 'zone':
            if (buildable && !this.map.bushes.has(idx) && !this.zone.has(idx)) {
              this.garden.delete(idx);
              this.zone.add(idx);
              changed++;
            }
            break;
          case 'garden':
            if (buildable && !this.map.bushes.has(idx) && !this.garden.has(idx) && this.map.structure[idx] === Structure.None) {
              this.zone.delete(idx);
              this.garden.add(idx);
              changed++;
            }
            break;
          case 'erase': {
            let did = false;
            if (this.designations.delete(idx)) did = true;
            if (this.zone.delete(idx)) did = true;
            if (this.garden.delete(idx)) did = true;
            if (this.cancelBlueprint(idx)) did = true;
            if (did) changed++;
            break;
          }
        }
      }
    }
    return changed;
  }

  // ---------- строительство ----------

  /** Можно ли поставить чертёж такой постройки в клетку. */
  canPlace(kind: BuildKind, x: number, y: number): boolean {
    if (!this.map.inBounds(x, y)) return false;
    const t = this.map.get(x, y);
    if (t !== Terrain.Grass && t !== Terrain.Dirt) return false;
    const idx = this.idxOf(x, y);
    if (this.blueprints.has(idx) || this.map.bushes.has(idx) || this.map.crops.has(idx) || this.items.stacks.has(idx)) return false;
    if (kind === 'floor') return this.map.floor[idx] === 0;
    return this.map.structure[idx] === Structure.None;
  }

  /** Ставит чертежи на подходящие клетки. Возвращает, сколько поставлено. */
  placeBlueprints(kind: BuildKind, cells: readonly Point[]): number {
    let placed = 0;
    for (const c of cells) {
      if (!this.canPlace(kind, c.x, c.y)) continue;
      this.blueprints.set(this.idxOf(c.x, c.y), { kind, delivered: 0, work: 0 });
      placed++;
    }
    return placed;
  }

  /** Убирает чертёж, возвращая подвезённые материалы. */
  cancelBlueprint(idx: number): boolean {
    const bp = this.blueprints.get(idx);
    if (!bp) return false;
    this.blueprints.delete(idx);
    if (bp.delivered > 0) {
      const { x, y } = this.pointOf(idx);
      this.items.drop(BUILD[bp.kind].item, bp.delivered, x, y);
    }
    return true;
  }

  /** Превращает готовый чертёж в постройку. */
  completeBlueprint(idx: number): void {
    const bp = this.blueprints.get(idx);
    if (!bp) return;
    this.blueprints.delete(idx);
    if (bp.kind === 'floor') this.map.floor[idx] = 1;
    else this.map.structure[idx] = STRUCTURE_OF[bp.kind];
    if (blocksMovement(bp.kind)) {
      this.zone.delete(idx);
      this.garden.delete(idx);
      this.map.crops.delete(idx);
      const stack = this.items.stacks.get(idx);
      if (stack) {
        this.items.stacks.delete(idx);
        const { x, y } = this.pointOf(idx);
        this.items.drop(stack.kind, stack.count, x, y);
      }
    }
    this.invalidateRooms();
    this.markDirty(idx);
  }

  /** Разбирает постройку (если нет — пол) и возвращает часть материалов. */
  removeBuilt(idx: number, refund: number): void {
    const id = this.map.structure[idx]!;
    let kind: BuildKind | null = null;
    if (id !== Structure.None) {
      this.map.structure[idx] = Structure.None;
      kind = id === Structure.Wall ? 'wall' : id === Structure.Door ? 'door' : id === Structure.Bed ? 'bed' : 'stove';
    } else if (this.map.floor[idx]) {
      this.map.floor[idx] = 0;
      kind = 'floor';
    }
    if (kind) {
      const n = Math.floor(BUILD[kind].count * refund);
      if (n > 0) {
        const { x, y } = this.pointOf(idx);
        this.items.drop(BUILD[kind].item, n, x, y);
      }
    }
    this.invalidateRooms();
    this.markDirty(idx);
  }

  // ---------- комнаты и запросы ----------

  /** Комнаты: пересчитываются лениво после любых изменений стен и дверей. */
  rooms(): RoomMap {
    this.roomCache ??= computeRooms(this.map);
    return this.roomCache;
  }

  invalidateRooms(): void {
    this.roomCache = null;
  }

  /** Индексы клеток с постройкой данного вида (Structure.*). */
  cellsWith(structure: number): number[] {
    const out: number[] = [];
    const arr = this.map.structure;
    for (let i = 0; i < arr.length; i++) if (arr[i] === structure) out.push(i);
    return out;
  }

  /** Готовых обедов на карте: на земле, на складе и в руках. */
  mealCount(): number {
    let n = this.items.total('meal');
    for (const p of this.pawns) if (p.carrying?.kind === 'meal') n += p.carrying.count;
    return n;
  }

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
      rice: this.items.total('rice', inZone),
      meal: this.items.total('meal', inZone),
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
    for (const c of this.map.crops.values()) if (c.growth < CROP.growTicks) c.growth++;
    for (const p of this.pawns) {
      p.prevX = p.x;
      p.prevY = p.y;
      this.updateNeeds(p);
      if ((this.tickCount + p.id) % MOOD.updateEvery === 0) this.updateMood(p);
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
    const onBed = sleeping && this.map.structure[p.cy * this.map.width + p.cx] === Structure.Bed;
    n.sleep = sleeping
      ? Math.min(100, n.sleep + perTick(NEEDS.sleepRestorePerDay) * (onBed ? BED_SLEEP_FACTOR : 1))
      : Math.max(0, n.sleep - perTick(NEEDS.sleepPerDay));
    if (relaxing) n.rest = Math.min(100, n.rest + perTick(NEEDS.relaxRestorePerDay));
    else if (working) n.rest = Math.max(0, n.rest - perTick(NEEDS.restWorkPerDay));
    else n.rest = Math.min(100, n.rest + perTick(NEEDS.restIdlePerDay));
  }

  /** Пересчёт настроения; ниже порога начинается срыв. */
  private updateMood(p: Pawn): void {
    pruneThoughts(p, this.tickCount);
    p.mood = computeMood(p, this.tickCount);
    if (p.breakUntil === null && p.mood < MOOD.breakBelow && this.tickCount >= p.breakCooldownUntil) {
      cancelJob(this, p);
      p.breakUntil = this.tickCount + this.rng.int(MOOD.breakMinTicks, MOOD.breakMaxTicks);
    }
  }

  private endBreak(p: Pawn): void {
    cancelJob(this, p);
    p.breakUntil = null;
    p.breakCooldownUntil = this.tickCount + MOOD.breakCooldown;
    addThought(p, 'catharsis', this.tickCount);
  }

  private think(p: Pawn): void {
    if (p.breakUntil !== null) {
      if (this.tickCount >= p.breakUntil) this.endBreak(p);
      else {
        if (p.job === null) startJob(this, p, planWander(this, p));
        return;
      }
    }
    if (p.job === null) {
      if (p.thinkCooldown > 0) {
        p.thinkCooldown--;
        return;
      }
      const plan = planStepOff(this, p) ?? planUrgent(this, p) ?? planWork(this, p);
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
