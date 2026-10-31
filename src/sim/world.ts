import {
  BED_SLEEP_FACTOR,
  BUILD,
  BUSH_FROZEN_AT,
  BUSH_MAX_BERRIES,
  BUSH_REGROW_TICKS,
  COLD_WAVE,
  COMBAT,
  CROP,
  GROW,
  HEALTH,
  HERB,
  DAY_TICKS,
  MAP_SIZE,
  MOOD,
  NEEDS,
  PAWN_COUNT,
  START_BERRIES,
  START_SILVER,
  STORY,
  THINK_COOLDOWN,
} from './balance';
import {
  STRUCTURE_OF,
  blocksMovement,
  kindOfStructure,
  type Blueprint,
  type BuildKind,
} from './build';
import { ItemStore, type ItemKind } from './items';
import {
  Layer,
  WORK_JOB_KINDS,
  cancelJob,
  planCritical,
  planDowned,
  planGoto,
  planStepOff,
  planStroll,
  planUrgent,
  planWander,
  planWork,
  runJob,
  startJob,
  type LayerId,
  type WorkType,
} from './jobs';
import { GameMap, Structure, Terrain, generateMap } from './map';
import { calendar, gameTime, growthFactor, indoorTemp, outdoorTemp, type GameTime } from './climate';
import { growTicksOf, isMature, kindOfCrop } from './crops';
import { initStory, tickStory, type LogEntry, type Story } from './events';
import { tickEnemies, type Fx } from './raid';
import { addWound, consciousness, isFatal, stepHealth, type BodyPart, type WoundKind } from './health';
import { addThought, computeMood, pruneThoughts } from './mood';
import { createPawn, isSick, snapToCell, type Pawn } from './pawn';
import type { Point } from './pathfinding';
import { Rng } from './rng';
import { computeRooms, type RoomMap } from './rooms';
import { effectsOf, exposureOf } from './traits';

export type Designation = 'chop' | 'mine' | 'deconstruct';
export type Order = 'chop' | 'mine' | 'zone' | 'garden' | 'herbs' | 'deconstruct' | 'erase';

export interface WorldOptions {
  pawnCount?: number;
  /** false — поселенцы сами не выбирают задачи (для тестов движения). */
  ai?: boolean;
  /** false — без стартовых ягод. */
  startItems?: boolean;
  /** true — без случайных событий и без черт у поселенцев (для тестов). */
  quiet?: boolean;
  /** Фиксированная уличная температура, °C (для тестов). */
  fixedTemp?: number;
  /** Праздные поселенцы гуляют (по умолчанию да; в режиме quiet — нет). */
  stroll?: boolean;
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
  /** Клетки огорода (рис). */
  readonly garden = new Set<number>();
  /** Клетки грядки целебных трав. */
  readonly herbs = new Set<number>();
  /** Чертежи будущих построек по индексу клетки. */
  readonly blueprints = new Map<number, Blueprint>();
  /** Клетки, у которых изменился вид (местность, постройки), — рендер перерисует их. */
  readonly dirty: number[] = [];
  tickCount = 0;
  /** Случайность симуляции (блуждание при срыве); состояние входит в сохранение. */
  readonly rng: Rng;
  /** Рассказчик: ближайшее событие, холодная волна, торговец, странник. */
  story: Story;
  /** Налётчики на карте (не входят в pawns: у них своё поведение). */
  enemies: Pawn[] = [];
  nextEnemyId = 0;
  /** Тревога: колонисты берут оружие и дерутся; alarmAuto — включена набегом, выключится сама. */
  alarm = false;
  alarmAuto = false;
  /** Эффекты ударов и выстрелов для отрисовки (не сохраняются). */
  fx: Fx[] = [];
  /** Журнал событий (последние STORY.logMax записей) и счётчик для уведомлений. */
  log: LogEntry[] = [];
  logSeq = 0;
  private tempAt = -1;
  private tempVal = 0;
  private readonly fixedTemp: number | undefined;
  /** Гуляют ли праздные поселенцы (сохраняется в файле). */
  readonly stroll: boolean;
  private readonly ai: boolean;
  private roomCache: RoomMap | null = null;
  private readonly reservations = new Map<number, number>();

  constructor(
    readonly seed: number,
    opts: WorldOptions = {},
  ) {
    this.ai = opts.ai ?? true;
    this.fixedTemp = opts.fixedTemp;
    this.stroll = opts.stroll ?? !opts.quiet;
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
    this.story = initStory((a, b) => this.rng.int(a, b), 0);
    if (opts.quiet) {
      this.story.nextEventTick = Number.MAX_SAFE_INTEGER;
      for (const p of this.pawns) p.traits = [];
    }
    if (opts.startItems ?? true) {
      this.items.drop('berries', START_BERRIES, c, c - 2);
      this.items.drop('silver', START_SILVER, c + 1, c - 2);
      this.items.drop('club', COMBAT.startClubs, c - 2, c - 2);
    }
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
              this.herbs.delete(idx);
              this.zone.add(idx);
              changed++;
            }
            break;
          case 'garden':
            if (buildable && !this.map.bushes.has(idx) && !this.garden.has(idx) && this.map.structure[idx] === Structure.None) {
              this.zone.delete(idx);
              this.herbs.delete(idx);
              this.garden.add(idx);
              changed++;
            }
            break;
          case 'herbs':
            if (buildable && !this.map.bushes.has(idx) && !this.herbs.has(idx) && this.map.structure[idx] === Structure.None) {
              this.zone.delete(idx);
              this.garden.delete(idx);
              this.herbs.add(idx);
              changed++;
            }
            break;
          case 'erase': {
            let did = false;
            if (this.designations.delete(idx)) did = true;
            if (this.zone.delete(idx)) did = true;
            if (this.garden.delete(idx)) did = true;
            if (this.herbs.delete(idx)) did = true;
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
      this.herbs.delete(idx);
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
      kind = kindOfStructure(id);
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

  // ---------- климат, журнал ----------

  addLog(text: string): void {
    this.log.push({ tick: this.tickCount, text });
    if (this.log.length > STORY.logMax) this.log.shift();
    this.logSeq++;
  }

  /** Температура на улице сейчас, °C (с поправкой на холодную волну). */
  outdoorTemp(): number {
    if (this.fixedTemp !== undefined) return this.fixedTemp;
    if (this.tempAt !== this.tickCount) {
      const wave = this.story.coldWaveUntil > this.tickCount ? COLD_WAVE.offset : 0;
      this.tempVal = outdoorTemp(this.tickCount, this.seed, wave);
      this.tempAt = this.tickCount;
    }
    return this.tempVal;
  }

  /** Температура в клетке: в комнате теплее, чем на улице. */
  tempAtCell(idx: number): number {
    const out = this.outdoorTemp();
    return this.rooms().roomOf[idx]! >= 0 ? indoorTemp(out) : out;
  }

  /** Сбросить кэш температуры (после смены холодной волны). */
  invalidateTemp(): void {
    this.tempAt = -1;
  }

  /** Живые поселенцы. */
  get living(): Pawn[] {
    return this.pawns.filter((p) => !p.dead);
  }

  /** Все погибли — игра проиграна. */
  get lost(): boolean {
    return this.pawns.length > 0 && this.pawns.every((p) => p.dead);
  }

  get traderPresent(): boolean {
    return this.story.trader !== null && this.tickCount < this.story.trader.until;
  }

  get time(): GameTime {
    return gameTime(this.tickCount);
  }

  get season(): number {
    return calendar(this.tickCount).season;
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

  /**
   * Сколько этой культуры уже есть или вырастет: лежит на земле и на складе, несётся в руках
   * и ещё стоит на грядках (по урожаю каждого посева).
   */
  cropPotential(kind: 'rice' | 'herb'): number {
    let n = this.items.total(kind);
    for (const p of this.pawns) if (p.carrying?.kind === kind) n += p.carrying.count;
    const perCrop = kind === 'herb' ? HERB.yield : CROP.yield;
    for (const c of this.map.crops.values()) if (kindOfCrop(c) === kind) n += perCrop;
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
      silver: this.items.total('silver', inZone),
      club: this.items.total('club', inZone),
      bow: this.items.total('bow', inZone),
      herb: this.items.total('herb', inZone),
      medkit: this.items.total('medkit', inZone),
    };
  }

  /** Включить или выключить тревогу вручную. */
  setAlarm(on: boolean): void {
    this.alarm = on;
    this.alarmAuto = false;
  }

  addFx(kind: Fx['kind'], a: Pawn, t: Pawn, hit: boolean): void {
    this.fx.push({ kind, x0: a.x + 0.5, y0: a.y + 0.5, x1: t.x + 0.5, y1: t.y + 0.5, hit, until: this.tickCount + COMBAT.fxTicks });
  }

  /** Есть предметы вне склада, а склада нет совсем. */
  get needsZone(): boolean {
    return this.zone.size === 0 && this.items.stacks.size > 0;
  }

  // ---------- тик ----------

  tick(): void {
    this.tickCount++;
    const temp = this.outdoorTemp();
    if (temp > BUSH_FROZEN_AT) {
      for (const b of this.map.bushes.values()) {
        if (b.berries < BUSH_MAX_BERRIES && --b.regrow <= 0) {
          b.berries++;
          b.regrow = BUSH_REGROW_TICKS;
        }
      }
    }
    const grow = growthFactor(temp);
    if (grow > 0) for (const c of this.map.crops.values()) if (!isMature(c)) c.growth = Math.min(growTicksOf(c), c.growth + grow);
    if (temp < GROW.frostKills && this.tickCount % 100 === 0) this.frostKill();
    tickStory(this);
    for (const p of this.pawns) {
      if (p.dead) continue;
      p.prevX = p.x;
      p.prevY = p.y;
      this.updateNeeds(p);
      if ((this.tickCount + p.id) % MOOD.updateEvery === 0) this.updateMood(p);
      if (p.attackCooldown > 0) p.attackCooldown--;
      if (p.wounds.length > 0 || p.blood < 100) this.healthTick(p);
      if (p.dead) continue;
      if (this.ai) this.think(p);
      runJob(this, p);
    }
    for (const e of this.enemies) if (!e.dead && (e.wounds.length > 0 || e.blood < 100)) this.healthTick(e);
    tickEnemies(this);
    if (this.fx.length > 0) this.fx = this.fx.filter((f) => f.until > this.tickCount);
    // несомых упавших переносит тот, кто несёт
    for (const p of this.pawns) {
      if (p.carriedBy === null || p.dead) continue;
      const c = this.pawns[p.carriedBy];
      if (!c || c.dead) {
        p.carriedBy = null;
        continue;
      }
      p.cx = c.cx;
      p.cy = c.cy;
      p.x = c.x;
      p.y = c.y;
      p.prevX = c.prevX;
      p.prevY = c.prevY;
      p.t = 0;
      p.path = [];
    }
  }

  private updateNeeds(p: Pawn): void {
    const n = p.needs;
    const perTick = (perDay: number) => perDay / DAY_TICKS;
    const job = p.job;
    const sleeping = job?.kind === 'sleep' && job.phase === 'act';
    const relaxing = job?.kind === 'relax' && job.phase === 'act';
    const working = job !== null && WORK_JOB_KINDS.has(job.kind);

    const fx = effectsOf(p.traits);
    const sickRest = isSick(p, this.tickCount) ? 1.3 : 1;
    n.food = Math.max(0, n.food - perTick(NEEDS.foodPerDay) * fx.foodDecay);
    const onBed = sleeping && this.map.structure[p.cy * this.map.width + p.cx] === Structure.Bed;
    n.sleep = sleeping
      ? Math.min(100, n.sleep + perTick(NEEDS.sleepRestorePerDay) * (onBed ? BED_SLEEP_FACTOR : 1))
      : Math.max(0, n.sleep - perTick(NEEDS.sleepPerDay) * fx.sleepDecay);
    if (relaxing) n.rest = Math.min(100, n.rest + perTick(NEEDS.relaxRestorePerDay));
    else if (working) n.rest = Math.max(0, n.rest - perTick(NEEDS.restWorkPerDay) * fx.restDecay * sickRest);
    else n.rest = Math.min(100, n.rest + perTick(NEEDS.restIdlePerDay));
  }

  /** Пересчёт настроения; ниже порога начинается срыв. */
  /** Заживление, кровотечение, потеря сознания и смерть. */
  private healthTick(p: Pawn): void {
    const lying = p.job !== null && (p.job.kind === 'bedrest' || p.job.kind === 'sleep' || p.job.kind === 'downed');
    const onBed = this.map.structure[p.cy * this.map.width + p.cx] === Structure.Bed;
    stepHealth(p, lying ? (onBed ? HEALTH.bedFactor : HEALTH.floorFactor) : 1);
    this.checkVitals(p);
  }

  /** Смерть от ран или кровопотери; падение без сознания и подъём. */
  private checkVitals(p: Pawn): void {
    if (isFatal(p)) {
      this.die(p);
      return;
    }
    const c = consciousness(p);
    if (!p.downed && c < HEALTH.downBelow) {
      p.downed = true;
      cancelJob(this, p);
      snapToCell(p);
      if (p.faction === 'colony') this.addLog(`${p.name} без сознания`);
    } else if (p.downed && c >= HEALTH.downBelow + HEALTH.getUpMargin) {
      p.downed = false;
    }
  }

  private die(p: Pawn): void {
    if (p.dead) return;
    cancelJob(this, p);
    snapToCell(p);
    p.dead = true;
    p.downed = false;
    p.deathTick = this.tickCount;
    p.carriedBy = null;
    p.ownedBed = null;
    p.breakUntil = null;
    if (p.weapon) {
      this.items.drop(p.weapon, 1, p.cx, p.cy);
      p.weapon = null;
    }
    if (p.faction === 'raider') {
      this.addLog(`Налётчик пал — ${p.name}`);
    } else {
      this.addLog(`Погиб — ${p.name}`);
      for (const q of this.pawns) if (!q.dead) addThought(q, 'colonistDied', this.tickCount);
    }
    this.markDirty(p.cy * this.map.width + p.cx);
  }

  /** Нанести рану (бой, отладка). Возвращает false, если поселенца нет или он мёртв. */
  injure(pawnId: number, part: BodyPart, kind: WoundKind, damage: number): boolean {
    const p = this.pawns[pawnId];
    if (!p || p.dead) return false;
    this.hurt(p, part, kind, damage);
    return true;
  }

  /** Рана любому бойцу — колонисту или налётчику. */
  hurt(p: Pawn, part: BodyPart, kind: WoundKind, damage: number): void {
    if (p.dead) return;
    addWound(p, part, kind, damage);
    this.checkVitals(p);
  }

  /** Заморозки гибнут незрелые посевы. */
  private frostKill(): void {
    let dead = 0;
    for (const [idx, c] of this.map.crops) {
      if (!isMature(c)) {
        this.map.crops.delete(idx);
        dead++;
      }
    }
    if (dead > 0) this.addLog('Заморозки погубили молодые посевы');
  }

  private updateMood(p: Pawn): void {
    const fx = effectsOf(p.traits);
    p.exposure = exposureOf(this.tempAtCell(p.cy * this.map.width + p.cx), fx);
    if (p.sickUntil > 0 && !isSick(p, this.tickCount)) {
      p.sickUntil = 0;
      this.addLog(`Болезнь прошла — ${p.name}`);
    }
    pruneThoughts(p, this.tickCount);
    for (const q of this.pawns) {
      if (q.dead && !q.buried && Math.max(Math.abs(q.cx - p.cx), Math.abs(q.cy - p.cy)) <= HEALTH.corpseRadius) {
        addThought(p, 'sawCorpse', this.tickCount);
        break;
      }
    }
    p.mood = computeMood(p, this.tickCount);
    if (p.breakUntil === null && p.mood < fx.breakBelow && this.tickCount >= p.breakCooldownUntil) {
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
    if (p.downed) {
      if (p.job?.kind !== 'downed') startJob(this, p, planDowned(p));
      return;
    }
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
      else if (this.stroll) startJob(this, p, planStroll(this, p));
      else p.thinkCooldown = THINK_COOLDOWN;
      return;
    }
    if (p.job.kind === 'stroll') {
      // прогулку прерывает любое дело или нужда
      if (--p.thinkCooldown > 0) return;
      p.thinkCooldown = THINK_COOLDOWN;
      const plan = planStepOff(this, p) ?? planUrgent(this, p) ?? planWork(this, p);
      if (plan) startJob(this, p, plan);
      return;
    }
    if (!WORK_JOB_KINDS.has(p.job.kind)) return;
    if (--p.thinkCooldown > 0) return;
    p.thinkCooldown = THINK_COOLDOWN;
    const plan = planCritical(this, p);
    // не перезапускаем ту же задачу (иначе прогресс сбрасывался бы каждый цикл)
    if (plan && plan.job.kind !== p.job.kind) startJob(this, p, plan);
  }

  /** Для отладки: сбросить задачу поселенца. */
  stopJob(pawnId: number): void {
    const p = this.pawns[pawnId];
    if (p) cancelJob(this, p);
  }
}

export { gameTime, type GameTime };
export { Layer };
