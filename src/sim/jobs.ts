import {
  BERRY_STOCK_TARGET,
  BUILD,
  BUILD_WAIT_LIMIT,
  BUSH_REGROW_TICKS,
  CARRY_MAX,
  COOK,
  CROP,
  DECONSTRUCT,
  FOOD_VALUE,
  HEALTH,
  MOOD,
  NEEDS,
  SICK,
  STROLL,
  STONE_PER_ROCK,
  WOOD_PER_TREE,
  WORK_TICKS,
} from './balance';
import { blocksMovement, kindOfStructure, type BuildKind } from './build';
import { isFood, type ItemKind } from './items';
import { addThought } from './mood';
import { Structure, Terrain } from './map';
import { findPath, findPathToAny, pathCost, type Point } from './pathfinding';
import { calendar, isNightHour } from './climate';
import { hasUntreated, needsBedrest, worstUntreated } from './health';
import { isSick, originOf, snapToCell, stepMovement, workSpeed, type Pawn, type SkillId } from './pawn';
import { effectsOf } from './traits';
import type { World } from './world';

/** 11 типов работ из ТЗ (в таблице приоритетов). Реализованы: растения, добыча, строительство, переноска. */
export type WorkType =
  | 'firefighting'
  | 'doctor'
  | 'cooking'
  | 'hunting'
  | 'construction'
  | 'plants'
  | 'mining'
  | 'crafting'
  | 'hauling'
  | 'cleaning'
  | 'research';
export const WORK_TYPES: readonly WorkType[] = [
  'firefighting', 'doctor', 'cooking', 'hunting', 'construction', 'plants', 'mining', 'crafting', 'hauling', 'cleaning', 'research',
];
export const IMPLEMENTED_WORKS: readonly WorkType[] = ['construction', 'cooking', 'doctor', 'plants', 'mining', 'hauling', 'cleaning'];

export type JobKind =
  | 'chop'
  | 'mine'
  | 'harvest'
  | 'sow'
  | 'reap'
  | 'haul'
  | 'deliver'
  | 'build'
  | 'deconstruct'
  | 'cook'
  | 'treat'
  | 'rescue'
  | 'bury'
  | 'bedrest'
  | 'downed'
  | 'eat'
  | 'sleep'
  | 'relax'
  | 'wander'
  | 'stroll'
  | 'goto';
type Phase = 'move' | 'act' | 'move2' | 'act2';

export interface Job {
  kind: JobKind;
  phase: Phase;
  /** Клетка объекта (дерево, камень, куст, стопка, чертёж…) или точка назначения для «иди сюда». */
  target: Point;
  /** Куда нести: клетка склада (haul) или чертежа (deliver). */
  dest?: Point;
  /** Для еды: откуда едим. */
  source?: 'stack' | 'bush';
  progress: number;
  /** Длительность действия в тиках; 0 — пока не выполнится условие (сон, отдых). */
  duration: number;
  /** Сколько тиков строитель ждёт освобождения клетки. */
  wait?: number;
  /** Номер пациента (лечение, спасение, похороны). */
  patientId?: number;
}

/** Слои резервирования: один объект — один исполнитель. */
export const Layer = { Designation: 0, Bush: 1, Item: 2, Dest: 3, Blueprint: 4, Crop: 5, Patient: 6 } as const;
export type LayerId = (typeof Layer)[keyof typeof Layer];

export interface Plan {
  job: Job;
  path: Point[];
  cost: number;
  reserve: [LayerId, number][];
}

/** Задачи, которые можно прервать срочной нуждой. */
export const WORK_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  'chop', 'mine', 'harvest', 'sow', 'reap', 'haul', 'deliver', 'build', 'deconstruct', 'cook', 'treat', 'rescue', 'bury',
]);

const NEIGHBORS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax + ay + (Math.SQRT2 - 2) * Math.min(ax, ay);
}

function idxOf(world: World, p: Point): number {
  return p.y * world.map.width + p.x;
}

function pointOf(world: World, idx: number): Point {
  return world.pointOf(idx);
}

/** Путь от текущей позиции поселенца до ближайшей из целей (с учётом недоделанного шага). */
function route(world: World, pawn: Pawn, goals: readonly Point[]): { path: Point[]; cost: number } | null {
  const o = originOf(pawn);
  const rest = findPathToAny(world.map, o.x, o.y, goals);
  if (!rest) return null;
  const midStep = pawn.t > 0 && pawn.path.length > 0;
  return { path: midStep ? [o, ...rest] : rest, cost: pathCost(world.map, o.x, o.y, rest) };
}

/** Из кандидатов берёт ближайшие по прямой, проверяет достижимость и выбирает самый дешёвый путь. */
function bestOf<T>(
  cands: readonly T[],
  posOf: (c: T) => Point,
  from: Point,
  tryPlan: (c: T) => Plan | null,
  limit = 4,
): Plan | null {
  const sorted = cands
    .map((c) => {
      const p = posOf(c);
      return { c, d: octile(p.x - from.x, p.y - from.y) };
    })
    .sort((a, b) => a.d - b.d);
  let best: Plan | null = null;
  let found = 0;
  for (let i = 0; i < sorted.length && i < limit * 3 && found < limit; i++) {
    const plan = tryPlan(sorted[i]!.c);
    if (!plan) continue;
    found++;
    if (!best || plan.cost < best.cost) best = plan;
  }
  return best;
}

function adjacentPassable(world: World, p: Point): Point[] {
  const out: Point[] = [];
  for (const [dx, dy] of NEIGHBORS) {
    const x = p.x + dx;
    const y = p.y + dy;
    if (world.map.isPassable(x, y)) out.push({ x, y });
  }
  return out;
}

// ---------- планирование: растения, добыча, переноска ----------

/** Приказы на клетку: рубка, добыча, разборка. Встают рядом (или на проходимую клетку). */
function planDesignation(world: World, pawn: Pawn, kind: 'chop' | 'mine' | 'deconstruct'): Plan | null {
  const cands: number[] = [];
  for (const [idx, d] of world.designations) {
    if (d === kind && world.isFree(Layer.Designation, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const goals = adjacentPassable(world, target);
      if (kind === 'deconstruct' && world.map.isPassable(target.x, target.y)) goals.push(target);
      const r = route(world, pawn, goals);
      if (!r) return null;
      return {
        job: { kind, phase: 'move', target, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Designation, idx]],
      };
    },
  );
}

function planHarvest(world: World, pawn: Pawn): Plan | null {
  if (world.totalBerries() >= BERRY_STOCK_TARGET) return null;
  const cands: number[] = [];
  for (const [idx, b] of world.map.bushes) {
    if (b.berries >= 3 && world.isFree(Layer.Bush, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'harvest', phase: 'move', target, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Bush, idx]],
      };
    },
  );
}

/** Посев на пустых клетках огорода. */
function planSow(world: World, pawn: Pawn): Plan | null {
  const cands: number[] = [];
  for (const idx of world.garden) {
    if (world.map.crops.has(idx) || world.blueprints.has(idx) || world.map.structure[idx] !== Structure.None) continue;
    if (world.isFree(Layer.Crop, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'sow', phase: 'move', target, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Crop, idx]],
      };
    },
  );
}

/** Сбор созревшего урожая. */
function planReap(world: World, pawn: Pawn): Plan | null {
  const cands: number[] = [];
  for (const [idx, c] of world.map.crops) {
    if (c.growth >= CROP.growTicks && world.isFree(Layer.Crop, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'reap', phase: 'move', target, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Crop, idx]],
      };
    },
  );
}

/** Ближайшая клетка склада, куда поместится хоть что-то из стопки. */
function pickDest(world: World, pawn: Pawn, from: Point, kind: ItemKind): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const idx of world.zone) {
    if (world.blueprints.has(idx) || world.items.roomAt(idx, kind) <= 0 || !world.isFree(Layer.Dest, idx, pawn.id)) continue;
    const p = pointOf(world, idx);
    const d = octile(p.x - from.x, p.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

function planHaul(world: World, pawn: Pawn): Plan | null {
  if (world.zone.size === 0) return null;
  const cands: number[] = [];
  for (const [idx, s] of world.items.stacks) {
    if (s.count > 0 && !world.zone.has(idx) && world.isFree(Layer.Item, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const stack = world.items.stacks.get(idx)!;
      const target = pointOf(world, idx);
      const destIdx = pickDest(world, pawn, target, stack.kind);
      if (destIdx === null) return null;
      const dest = pointOf(world, destIdx);
      if (!findPath(world.map, target.x, target.y, dest.x, dest.y)) return null;
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'haul', phase: 'move', target, dest, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Item, idx], [Layer.Dest, destIdx]],
      };
    },
  );
}

// ---------- планирование: строительство ----------

/** Подвоз материала на чертёж: берём ближайшую свободную стопку нужного вида. */
function planDeliver(world: World, pawn: Pawn): Plan | null {
  const cands: number[] = [];
  for (const [idx, bp] of world.blueprints) {
    if (bp.delivered < BUILD[bp.kind].count && world.isFree(Layer.Blueprint, idx, pawn.id)) cands.push(idx);
  }
  const o = originOf(pawn);
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    o,
    (idx) => {
      const bp = world.blueprints.get(idx)!;
      const item = BUILD[bp.kind].item;
      const dest = pointOf(world, idx);
      let best = -1;
      let bestD = Infinity;
      for (const [sidx, s] of world.items.stacks) {
        if (s.kind !== item || s.count <= 0 || !world.isFree(Layer.Item, sidx, pawn.id)) continue;
        const p = pointOf(world, sidx);
        const d = octile(p.x - o.x, p.y - o.y) + octile(p.x - dest.x, p.y - dest.y);
        if (d < bestD) {
          bestD = d;
          best = sidx;
        }
      }
      if (best < 0) return null;
      const target = pointOf(world, best);
      if (!findPath(world.map, target.x, target.y, dest.x, dest.y)) return null;
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'deliver', phase: 'move', target, dest, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Item, best], [Layer.Blueprint, idx]],
      };
    },
  );
}

/** Постройка по чертежу, на который уже привезён весь материал. */
function planBuild(world: World, pawn: Pawn): Plan | null {
  const cands: number[] = [];
  for (const [idx, bp] of world.blueprints) {
    if (bp.delivered >= BUILD[bp.kind].count && world.isFree(Layer.Blueprint, idx, pawn.id)) cands.push(idx);
  }
  return bestOf(
    cands,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, adjacentPassable(world, target));
      if (!r) return null;
      return {
        job: { kind: 'build', phase: 'move', target, progress: 0, duration: 1 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Blueprint, idx]],
      };
    },
  );
}

function cheaper(a: Plan | null, b: Plan | null): Plan | null {
  if (!a) return b;
  if (!b) return a;
  return b.cost < a.cost ? b : a;
}

/** Готовка: несём сырую еду из ближайшей стопки к свободной плите и варим обеды. */
function planCook(world: World, pawn: Pawn): Plan | null {
  if (world.mealCount() >= COOK.mealTarget) return null;
  const stoves = world.cellsWith(Structure.Stove).filter((i) => world.isFree(Layer.Dest, i, pawn.id));
  if (stoves.length === 0) return null;
  const stacks: number[] = [];
  for (const [idx, s] of world.items.stacks) {
    if ((s.kind === 'berries' || s.kind === 'rice') && s.count >= COOK.raw && world.isFree(Layer.Item, idx, pawn.id)) stacks.push(idx);
  }
  return bestOf(
    stacks,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      let stove = -1;
      let bestD = Infinity;
      for (const sidx of stoves) {
        const p = pointOf(world, sidx);
        const d = octile(p.x - target.x, p.y - target.y);
        if (d < bestD) {
          bestD = d;
          stove = sidx;
        }
      }
      const dest = pointOf(world, stove);
      if (!findPathToAny(world.map, target.x, target.y, adjacentPassable(world, dest))) return null;
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'cook', phase: 'move', target, dest, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Item, idx], [Layer.Dest, stove]],
      };
    },
  );
}

/** Живые поселенцы, не считая самого исполнителя. */
function others(world: World, pawn: Pawn): Pawn[] {
  return world.pawns.filter((q) => !q.dead && q.id !== pawn.id);
}

/** Есть ли кто-то другой, способный лечить: жив, в сознании и врачебная работа у него включена. */
function otherDoctors(world: World, pawn: Pawn): number {
  return others(world, pawn).filter((q) => !q.downed && q.priorities.doctor > 0).length;
}

/** Лечение: врач идёт к раненому и перевязывает самую опасную рану. Себя лечит, если больше некому. */
function planTreat(world: World, pawn: Pawn): Plan | null {
  const alone = otherDoctors(world, pawn) === 0;
  const patients = world.pawns.filter(
    (q) => !q.dead && q.carriedBy === null && hasUntreated(q) && world.isFree(Layer.Patient, q.id, pawn.id) && (q.id !== pawn.id || alone),
  );
  return bestOf(
    patients,
    (q) => ({ x: q.cx, y: q.cy }),
    originOf(pawn),
    (q) => {
      const target = { x: q.cx, y: q.cy };
      const goals = q.id === pawn.id ? [target] : [...adjacentPassable(world, target), target];
      const r = route(world, pawn, goals);
      if (!r) return null;
      return {
        job: { kind: 'treat', phase: 'move', target, patientId: q.id, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Patient, q.id]],
      };
    },
  );
}

/** Кровать для раненого: закреплённая или свободная ближайшая. Возвращает индекс клетки или null. */
function bedFor(world: World, patient: Pawn): number | null {
  if (patient.ownedBed !== null && world.map.structure[patient.ownedBed] === Structure.Bed) return patient.ownedBed;
  const taken = new Set(world.pawns.map((p) => p.ownedBed));
  let best: number | null = null;
  let bestD = Infinity;
  for (const idx of world.cellsWith(Structure.Bed)) {
    if (taken.has(idx)) continue;
    const p = pointOf(world, idx);
    const d = octile(p.x - patient.cx, p.y - patient.cy);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

/** Спасение: отнести упавшего на кровать. */
function planRescue(world: World, pawn: Pawn): Plan | null {
  const downed = world.pawns.filter(
    (q) => !q.dead && q.downed && q.carriedBy === null && q.id !== pawn.id && world.isFree(Layer.Patient, q.id, pawn.id) && world.map.structure[q.cy * world.map.width + q.cx] !== Structure.Bed,
  );
  return bestOf(
    downed,
    (q) => ({ x: q.cx, y: q.cy }),
    originOf(pawn),
    (q) => {
      const bed = bedFor(world, q);
      if (bed === null) return null;
      const target = { x: q.cx, y: q.cy };
      const dest = pointOf(world, bed);
      if (!findPath(world.map, target.x, target.y, dest.x, dest.y)) return null;
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'rescue', phase: 'move', target, dest, patientId: q.id, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Patient, q.id]],
      };
    },
  );
}

/** Похороны: отнести труп в землю (убрать с карты). */
function planBury(world: World, pawn: Pawn): Plan | null {
  const corpses = world.pawns.filter((q) => q.dead && !q.buried && world.isFree(Layer.Patient, q.id, pawn.id));
  return bestOf(
    corpses,
    (q) => ({ x: q.cx, y: q.cy }),
    originOf(pawn),
    (q) => {
      const target = { x: q.cx, y: q.cy };
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'bury', phase: 'move', target, patientId: q.id, progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Patient, q.id]],
      };
    },
  );
}

const PLANNERS: Partial<Record<WorkType, (world: World, pawn: Pawn) => Plan | null>> = {
  doctor: (w, p) => cheaper(planTreat(w, p), planRescue(w, p)),
  cleaning: planBury,
  cooking: planCook,
  plants: (w, p) => cheaper(cheaper(planDesignation(w, p, 'chop'), planHarvest(w, p)), cheaper(planReap(w, p), planSow(w, p))),
  mining: (w, p) => planDesignation(w, p, 'mine'),
  construction: (w, p) =>
    cheaper(cheaper(planBuild(w, p), planDeliver(w, p)), planDesignation(w, p, 'deconstruct')),
  hauling: planHaul,
};

/** Работа по приоритетам: 1 раньше 4, при равенстве — ближайшая. */
export function planWork(world: World, pawn: Pawn): Plan | null {
  for (let prio = 1; prio <= 4; prio++) {
    let best: Plan | null = null;
    for (const w of IMPLEMENTED_WORKS) {
      if (pawn.priorities[w] !== prio) continue;
      best = cheaper(best, PLANNERS[w]!(world, pawn));
    }
    if (best) return best;
  }
  return null;
}

// ---------- планирование: нужды ----------

export function planEat(world: World, pawn: Pawn): Plan | null {
  const meals: number[] = [];
  const raws: number[] = [];
  for (const [idx, s] of world.items.stacks) {
    if (!isFood(s.kind) || s.count <= 0 || !world.isFree(Layer.Item, idx, pawn.id)) continue;
    (s.kind === 'meal' ? meals : raws).push(idx);
  }
  const eatFromStack = (idx: number): Plan | null => {
    const target = pointOf(world, idx);
    const r = route(world, pawn, [target]);
    if (!r) return null;
    return {
      job: { kind: 'eat', phase: 'move', target, source: 'stack', progress: 0, duration: 0 },
      path: r.path,
      cost: r.cost,
      reserve: [[Layer.Item, idx]],
    };
  };
  // готовую еду предпочитаем сырой
  const fromStack =
    bestOf(meals, (idx) => pointOf(world, idx), originOf(pawn), eatFromStack) ??
    bestOf(raws, (idx) => pointOf(world, idx), originOf(pawn), eatFromStack);
  if (fromStack) return fromStack;

  const bushes: number[] = [];
  for (const [idx, b] of world.map.bushes) {
    if (b.berries >= 1 && world.isFree(Layer.Bush, idx, pawn.id)) bushes.push(idx);
  }
  return bestOf(
    bushes,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'eat', phase: 'move', target, source: 'bush', progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Bush, idx]],
      };
    },
  );
}

/** Сон и отдых: сначала дойти до конца текущего шага, затем остаться на месте. */
function planStay(pawn: Pawn, kind: 'sleep' | 'relax' | 'bedrest'): Plan {
  const o = originOf(pawn);
  const midStep = pawn.t > 0 && pawn.path.length > 0;
  return {
    job: { kind, phase: 'move', target: o, progress: 0, duration: 0 },
    path: midStep ? [o] : [],
    cost: 0,
    reserve: [],
  };
}

/** Раненый перевязывает себя сам, только если ему некому помочь и врачебная работа у него включена. */
function selfTreat(world: World, pawn: Pawn): Plan | null {
  if (!hasUntreated(pawn) || pawn.priorities.doctor <= 0 || pawn.downed || otherDoctors(world, pawn) > 0) return null;
  return planTreat(world, pawn);
}

/** Сон: в закреплённой (или свободной) кровати, иначе на полу там, где стоит. */
export function planSleep(world: World, pawn: Pawn): Plan {
  return planLie(world, pawn, 'sleep');
}

/** Постельный режим раненого: та же кровать, что и для сна, но без лимита по сну. */
export function planBedrest(world: World, pawn: Pawn): Plan {
  return planLie(world, pawn, 'bedrest');
}

/** Упавший без сознания лежит, где упал. */
export function planDowned(pawn: Pawn): Plan {
  const o = originOf(pawn);
  return { job: { kind: 'downed', phase: 'act', target: o, progress: 0, duration: 0 }, path: [], cost: 0, reserve: [] };
}

function planLie(world: World, pawn: Pawn, kind: 'sleep' | 'bedrest'): Plan {
  let bed = pawn.ownedBed;
  if (bed !== null && world.map.structure[bed] !== Structure.Bed) {
    pawn.ownedBed = null; // кровать разобрали
    bed = null;
  }
  if (bed === null) {
    const taken = new Set(world.pawns.map((p) => p.ownedBed));
    const o = originOf(pawn);
    let bestD = Infinity;
    for (const idx of world.cellsWith(Structure.Bed)) {
      if (taken.has(idx)) continue;
      const p = pointOf(world, idx);
      const d = octile(p.x - o.x, p.y - o.y);
      if (d < bestD) {
        bestD = d;
        bed = idx;
      }
    }
  }
  if (bed !== null) {
    const target = pointOf(world, bed);
    const r = route(world, pawn, [target]);
    if (r) {
      pawn.ownedBed = bed;
      return { job: { kind, phase: 'move', target, progress: 0, duration: 0 }, path: r.path, cost: r.cost, reserve: [] };
    }
  }
  return planStay(pawn, kind);
}

/** Блуждание во время срыва: случайная клетка рядом и пауза. */
export function planWander(world: World, pawn: Pawn): Plan {
  const o = originOf(pawn);
  for (let i = 0; i < 8; i++) {
    const x = o.x + world.rng.int(-MOOD.wanderRadius, MOOD.wanderRadius);
    const y = o.y + world.rng.int(-MOOD.wanderRadius, MOOD.wanderRadius);
    if (!world.map.isPassable(x, y)) continue;
    const r = route(world, pawn, [{ x, y }]);
    if (r) return { job: { kind: 'wander', phase: 'move', target: { x, y }, progress: 0, duration: 0 }, path: r.path, cost: r.cost, reserve: [] };
  }
  const stay = planStay(pawn, 'relax');
  stay.job.kind = 'wander';
  return stay;
}

/** Порог сна: днём «срочно» при 20, ночью раньше (по черте), больной ложится при 70. */
function sleepThreshold(world: World, pawn: Pawn): number {
  if (isSick(pawn, world.tickCount)) return SICK.sleepUrgent;
  if (isNightHour(calendar(world.tickCount).hourFloat)) return effectsOf(pawn.traits).nightSleep;
  return NEEDS.sleepUrgent;
}

/** Прогулка, когда делать нечего: случайная клетка рядом с лагерем, потом пауза. */
export function planStroll(world: World, pawn: Pawn): Plan {
  const o = originOf(pawn);
  const cx = Math.floor(world.map.width / 2);
  const cy = Math.floor(world.map.height / 2);
  for (let i = 0; i < 8; i++) {
    const x = o.x + world.rng.int(-STROLL.radius, STROLL.radius);
    const y = o.y + world.rng.int(-STROLL.radius, STROLL.radius);
    if ((x === o.x && y === o.y) || !world.map.isPassable(x, y)) continue;
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > STROLL.homeRadius) continue;
    const r = route(world, pawn, [{ x, y }]);
    if (r) return { job: { kind: 'stroll', phase: 'move', target: { x, y }, progress: 0, duration: 0 }, path: r.path, cost: r.cost, reserve: [] };
  }
  const stay = planStay(pawn, 'relax');
  stay.job.kind = 'stroll';
  return stay;
}

/** Срочные нужды: еда, затем сон, затем отдых. */
export function planUrgent(world: World, pawn: Pawn): Plan | null {
  const n = pawn.needs;
  if (n.food < NEEDS.foodUrgent) {
    const p = planEat(world, pawn);
    if (p) return p;
  }
  const self = selfTreat(world, pawn);
  if (self) return self;
  if (needsBedrest(pawn)) return planBedrest(world, pawn);
  if (n.sleep < sleepThreshold(world, pawn)) return planSleep(world, pawn);
  if (n.rest < NEEDS.restUrgent) return planStay(pawn, 'relax');
  return null;
}

/** Критические нужды — единственное, что прерывает рабочую задачу. */
export function planCritical(world: World, pawn: Pawn): Plan | null {
  const n = pawn.needs;
  if (n.food <= NEEDS.foodCritical) {
    const p = planEat(world, pawn);
    if (p) return p;
  }
  const self = selfTreat(world, pawn);
  if (self) return self;
  if (needsBedrest(pawn)) return planBedrest(world, pawn);
  if (n.sleep <= NEEDS.sleepCritical) return planSleep(world, pawn);
  return null;
}

export function planGoto(world: World, pawn: Pawn, x: number, y: number): Plan | null {
  const r = route(world, pawn, [{ x, y }]);
  if (!r) return null;
  return {
    job: { kind: 'goto', phase: 'move', target: { x, y }, progress: 0, duration: 0 },
    path: r.path,
    cost: r.cost,
    reserve: [],
  };
}

/** Праздный поселенец стоит на клетке, где скоро будет стена или плита, — отходит в сторону. */
export function planStepOff(world: World, pawn: Pawn): Plan | null {
  if (pawn.t > 0) return null;
  const here = world.blueprints.get(pawn.cy * world.map.width + pawn.cx);
  if (!here || !blocksMovement(here.kind)) return null;
  const goals: Point[] = [];
  for (let r = 1; r <= 4 && goals.length === 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = pawn.cx + dx;
        const y = pawn.cy + dy;
        if (world.map.isPassable(x, y) && !world.blueprints.has(y * world.map.width + x)) goals.push({ x, y });
      }
    }
  }
  return goals.length === 0 ? null : planGotoAny(world, pawn, goals);
}

function planGotoAny(world: World, pawn: Pawn, goals: Point[]): Plan | null {
  const r = route(world, pawn, goals);
  if (!r) return null;
  const end = r.path.length > 0 ? r.path[r.path.length - 1]! : originOf(pawn);
  return {
    job: { kind: 'goto', phase: 'move', target: end, progress: 0, duration: 0 },
    path: r.path,
    cost: r.cost,
    reserve: [],
  };
}

// ---------- запуск и завершение ----------

export function startJob(world: World, pawn: Pawn, plan: Plan): void {
  cancelJob(world, pawn);
  for (const [layer, idx] of plan.reserve) world.reserve(layer, idx, pawn.id);
  pawn.job = plan.job;
  pawn.path = plan.path;
  pawn.target = plan.path.length > 0 ? plan.path[plan.path.length - 1]! : null;
  pawn.thinkCooldown = 0;
}

/** Снимает задачу: освобождает резервы, роняет ношу, дошагивает текущий шаг. */
export function cancelJob(world: World, pawn: Pawn): void {
  world.releaseAll(pawn.id);
  for (const q of world.pawns) if (q.carriedBy === pawn.id) q.carriedBy = null; // роняем несомого на месте
  if (pawn.carrying) {
    world.items.drop(pawn.carrying.kind, pawn.carrying.count, pawn.cx, pawn.cy);
    pawn.carrying = null;
  }
  pawn.job = null;
  pawn.target = null;
  pawn.thinkCooldown = 0;
  pawn.path = pawn.t > 0 && pawn.path.length > 0 ? [pawn.path[0]!] : [];
}

function stillValid(world: World, pawn: Pawn, job: Job): boolean {
  const idx = idxOf(world, job.target);
  switch (job.kind) {
    case 'chop':
      return world.designations.get(idx) === 'chop' && world.map.get(job.target.x, job.target.y) === Terrain.Tree;
    case 'mine':
      return world.designations.get(idx) === 'mine' && world.map.get(job.target.x, job.target.y) === Terrain.Stone;
    case 'deconstruct':
      return world.designations.get(idx) === 'deconstruct' && world.hasBuilt(idx);
    case 'harvest':
      return (world.map.bushes.get(idx)?.berries ?? 0) >= 1;
    case 'sow':
      return world.garden.has(idx) && !world.map.crops.has(idx) && !world.blueprints.has(idx) && world.map.structure[idx] === Structure.None;
    case 'reap':
      return (world.map.crops.get(idx)?.growth ?? 0) >= CROP.growTicks;
    case 'build': {
      const bp = world.blueprints.get(idx);
      return !!bp && bp.delivered >= BUILD[bp.kind].count;
    }
    case 'treat': {
      const q = world.pawns[job.patientId!];
      if (!q || q.dead || !hasUntreated(q)) return false;
      return true;
    }
    case 'rescue': {
      const q = world.pawns[job.patientId!];
      if (!q || q.dead || !q.downed) return false;
      return job.phase === 'move' || job.phase === 'act' ? q.carriedBy === null : q.carriedBy === pawn.id;
    }
    case 'bury': {
      const q = world.pawns[job.patientId!];
      return !!q && q.dead && !q.buried;
    }
    case 'downed':
      return true;
    case 'cook':
      if (world.map.structure[idxOf(world, job.dest!)] !== Structure.Stove) return false;
      if (job.phase === 'move2' || job.phase === 'act2') return true;
      return (world.items.stacks.get(idx)?.count ?? 0) >= COOK.raw;
    case 'deliver': {
      if (!world.blueprints.has(idxOf(world, job.dest!))) return false;
      if (job.phase === 'move2' || job.phase === 'act2') return true;
      return (world.items.stacks.get(idx)?.count ?? 0) > 0;
    }
    case 'haul':
      if (job.phase === 'move2' || job.phase === 'act2') return true;
      return (world.items.stacks.get(idx)?.count ?? 0) > 0;
    case 'eat':
      return job.source === 'bush'
        ? (world.map.bushes.get(idx)?.berries ?? 0) >= 1
        : (world.items.stacks.get(idx)?.count ?? 0) > 0;
    default:
      return true;
  }
}

function skillOf(kind: JobKind): SkillId | null {
  switch (kind) {
    case 'chop':
    case 'harvest':
    case 'sow':
    case 'reap':
      return 'plants';
    case 'mine':
      return 'mining';
    case 'build':
    case 'deliver':
    case 'deconstruct':
      return 'construction';
    case 'cook':
      return 'cooking';
    case 'treat':
    case 'rescue':
      return 'medicine';
    default:
      return null;
  }
}

/** Что стоит в клетке для разборки: постройка, иначе пол. */
function builtKindAt(world: World, idx: number): BuildKind | null {
  return kindOfStructure(world.map.structure[idx]!) ?? (world.map.floor[idx] ? 'floor' : null);
}

function arrive(world: World, pawn: Pawn, job: Job): void {
  job.progress = 0;
  const skill = skillOf(job.kind);
  const speed = skill ? workSpeed(pawn, skill, world.tickCount) : 1;
  switch (job.kind) {
    case 'goto':
      endJob(world, pawn);
      return;
    case 'chop':
      job.phase = 'act';
      job.duration = WORK_TICKS.chop / speed;
      return;
    case 'mine':
      job.phase = 'act';
      job.duration = WORK_TICKS.mine / speed;
      return;
    case 'harvest': {
      const bush = world.map.bushes.get(idxOf(world, job.target));
      job.phase = 'act';
      job.duration = ((bush?.berries ?? 1) * WORK_TICKS.berry) / speed;
      return;
    }
    case 'sow':
      job.phase = 'act';
      job.duration = CROP.sowTicks / speed;
      return;
    case 'reap':
      job.phase = 'act';
      job.duration = CROP.reapTicks / speed;
      return;
    case 'build':
      job.phase = 'act';
      job.duration = 1;
      job.wait = 0;
      return;
    case 'deconstruct': {
      const kind = builtKindAt(world, idxOf(world, job.target));
      job.phase = 'act';
      job.duration = kind ? (BUILD[kind].ticks * DECONSTRUCT.timeFactor) / speed : 1;
      return;
    }
    case 'haul':
    case 'deliver':
    case 'cook':
      if (job.phase === 'move') {
        job.phase = 'act';
        job.duration = WORK_TICKS.pickup;
      } else {
        job.phase = 'act2';
        job.duration = job.kind === 'cook' ? COOK.ticks / speed : WORK_TICKS.drop;
      }
      return;
    case 'treat': {
      const q = world.pawns[job.patientId!];
      // пациент мог уйти — тогда задачу выберем заново
      if (!q || Math.max(Math.abs(q.cx - pawn.cx), Math.abs(q.cy - pawn.cy)) > 1) {
        endJob(world, pawn);
        return;
      }
      job.phase = 'act';
      job.duration = HEALTH.treatTicks / speed;
      return;
    }
    case 'rescue':
      if (job.phase === 'move') {
        job.phase = 'act';
        job.duration = HEALTH.rescueLiftTicks;
      } else {
        job.phase = 'act2';
        job.duration = HEALTH.rescuePlaceTicks;
      }
      return;
    case 'bury':
      job.phase = 'act';
      job.duration = HEALTH.buryTicks;
      return;
    case 'bedrest':
    case 'sleep':
      job.phase = 'act';
      job.duration = 0;
      return;
    case 'wander':
      job.phase = 'act';
      job.duration = world.rng.int(MOOD.wanderPauseMin, MOOD.wanderPauseMax);
      return;
    case 'stroll':
      job.phase = 'act';
      job.duration = world.rng.int(STROLL.pauseMin, STROLL.pauseMax);
      return;
    case 'eat':
      job.phase = 'act';
      job.duration = WORK_TICKS.eat;
      return;
    case 'relax':
      job.phase = 'act';
      job.duration = 0;
      return;
  }
}

function finishAction(world: World, pawn: Pawn, job: Job): void {
  const { x, y } = job.target;
  const idx = idxOf(world, job.target);
  switch (job.kind) {
    case 'chop':
      world.map.set(x, y, Terrain.Grass);
      world.designations.delete(idx);
      world.markDirty(idx);
      world.items.drop('wood', WOOD_PER_TREE, x, y);
      endJob(world, pawn);
      return;
    case 'mine':
      world.map.set(x, y, Terrain.Dirt);
      world.designations.delete(idx);
      world.markDirty(idx);
      world.items.drop('stone', STONE_PER_ROCK, x, y);
      world.invalidateRooms();
      endJob(world, pawn);
      return;
    case 'deconstruct':
      world.removeBuilt(idx, DECONSTRUCT.refund);
      world.designations.delete(idx);
      endJob(world, pawn);
      return;
    case 'harvest': {
      const bush = world.map.bushes.get(idx);
      if (bush && bush.berries > 0) {
        const n = bush.berries;
        bush.berries = 0;
        if (bush.regrow <= 0) bush.regrow = BUSH_REGROW_TICKS;
        world.items.drop('berries', n, x, y);
      }
      endJob(world, pawn);
      return;
    }
    case 'sow':
      world.map.crops.set(idx, { growth: 0 });
      endJob(world, pawn);
      return;
    case 'reap':
      world.map.crops.delete(idx);
      world.items.drop('rice', CROP.yield, x, y);
      endJob(world, pawn);
      return;
    case 'eat': {
      let eaten = 0;
      let value: number = FOOD_VALUE.berries;
      if (job.source === 'bush') {
        const bush = world.map.bushes.get(idx);
        if (bush) {
          const need = Math.max(1, Math.ceil((NEEDS.eatTarget - pawn.needs.food) / value));
          eaten = Math.min(bush.berries, need);
          bush.berries -= eaten;
          if (bush.regrow <= 0) bush.regrow = BUSH_REGROW_TICKS;
        }
      } else {
        const stack = world.items.stacks.get(idx);
        if (stack && isFood(stack.kind)) {
          value = FOOD_VALUE[stack.kind];
          const need = Math.max(1, Math.ceil((NEEDS.eatTarget - pawn.needs.food) / value));
          eaten = world.items.take(idx, need);
        }
      }
      pawn.needs.food = Math.min(100, pawn.needs.food + eaten * value);
      if (eaten > 0) addThought(pawn, value === FOOD_VALUE.meal ? 'ateMeal' : 'ateRaw', world.tickCount);
      endJob(world, pawn);
      return;
    }
    case 'haul':
    case 'deliver':
    case 'cook':
      if (job.phase === 'act') pickUp(world, pawn, job);
      else dropAtDest(world, pawn, job);
      return;
    case 'treat': {
      const q = world.pawns[job.patientId!];
      const w = q ? worstUntreated(q) : null;
      if (q && w) {
        w.treated = true;
        w.bleed = 0;
        w.quality = 1 + pawn.skills.medicine * HEALTH.qualityPerSkill;
      }
      endJob(world, pawn);
      return;
    }
    case 'rescue':
      if (job.phase === 'act') liftPatient(world, pawn, job);
      else placePatient(world, pawn, job);
      return;
    case 'bury': {
      const q = world.pawns[job.patientId!];
      if (q) {
        q.buried = true;
        world.addLog(`Похоронен — ${q.name}`);
      }
      endJob(world, pawn);
      return;
    }
    case 'wander':
    case 'stroll':
      endJob(world, pawn);
      return;
    default:
      return;
  }
}

/** Подхватить упавшего и идти к кровати. */
function liftPatient(world: World, pawn: Pawn, job: Job): void {
  const q = world.pawns[job.patientId!];
  const dest = job.dest!;
  if (!q || q.dead || !q.downed) {
    endJob(world, pawn);
    return;
  }
  const path = findPath(world.map, pawn.cx, pawn.cy, dest.x, dest.y);
  if (!path) {
    endJob(world, pawn);
    return;
  }
  snapToCell(q);
  q.carriedBy = pawn.id;
  pawn.path = path;
  pawn.target = dest;
  job.phase = 'move2';
  job.progress = 0;
  job.duration = 0;
}

/** Уложить на кровать; кровать закрепляется за раненым. */
function placePatient(world: World, pawn: Pawn, job: Job): void {
  const q = world.pawns[job.patientId!];
  const dest = job.dest!;
  if (q && !q.dead) {
    q.carriedBy = null;
    q.cx = q.x = q.prevX = dest.x;
    q.cy = q.y = q.prevY = dest.y;
    q.t = 0;
    q.path = [];
    const bedIdx = idxOf(world, dest);
    const taken = world.pawns.some((p) => p.id !== q.id && p.ownedBed === bedIdx);
    if (!taken) q.ownedBed = bedIdx;
  }
  endJob(world, pawn);
}

function pickUp(world: World, pawn: Pawn, job: Job): void {
  const idx = idxOf(world, job.target);
  const stack = world.items.stacks.get(idx);
  const dest = job.dest!;
  const destIdx = idxOf(world, dest);
  if (!stack) {
    endJob(world, pawn);
    return;
  }
  let limit: number;
  if (job.kind === 'cook') {
    limit = stack.count >= COOK.raw ? COOK.raw : 0;
  } else if (job.kind === 'deliver') {
    const bp = world.blueprints.get(destIdx);
    if (!bp) {
      endJob(world, pawn);
      return;
    }
    limit = BUILD[bp.kind].count - bp.delivered;
  } else {
    limit = world.items.roomAt(destIdx, stack.kind);
  }
  const amount = Math.min(stack.count, CARRY_MAX, limit);
  if (amount <= 0) {
    endJob(world, pawn);
    return;
  }
  const kind = stack.kind;
  pawn.carrying = { kind, count: world.items.take(idx, amount) };
  world.release(Layer.Item, idx, pawn.id);
  const path =
    job.kind === 'cook'
      ? findPathToAny(world.map, pawn.cx, pawn.cy, adjacentPassable(world, dest))
      : findPath(world.map, pawn.cx, pawn.cy, dest.x, dest.y);
  if (!path) {
    endJob(world, pawn); // ношу уронит cancelJob
    return;
  }
  pawn.path = path;
  pawn.target = path.length > 0 ? path[path.length - 1]! : null;
  job.phase = 'move2';
  job.progress = 0;
  job.duration = 0;
}

function dropAtDest(world: World, pawn: Pawn, job: Job): void {
  const c = pawn.carrying;
  if (job.kind === 'cook') {
    // сырьё израсходовано, у плиты появляются обеды
    pawn.carrying = null;
    if (c) world.items.drop('meal', COOK.meals, pawn.cx, pawn.cy);
    endJob(world, pawn);
    return;
  }
  if (c) {
    const dest = job.dest!;
    let left = c.count;
    if (job.kind === 'deliver') {
      const bp = world.blueprints.get(idxOf(world, dest));
      if (bp) {
        const add = Math.min(left, BUILD[bp.kind].count - bp.delivered);
        bp.delivered += add;
        left -= add;
      }
    }
    if (left > 0) world.items.drop(c.kind, left, dest.x, dest.y);
    pawn.carrying = null;
  }
  endJob(world, pawn);
}

/** Стоит ли кто-то в клетке (или входит в неё): стену туда ставить нельзя. */
function occupied(world: World, x: number, y: number): boolean {
  return world.pawns.some((p) => !p.dead && ((p.cx === x && p.cy === y) || (p.path[0]?.x === x && p.path[0]?.y === y)));
}

function actBuild(world: World, pawn: Pawn, job: Job): void {
  const idx = idxOf(world, job.target);
  const bp = world.blueprints.get(idx)!;
  if (bp.work < 1) {
    bp.work = Math.min(1, bp.work + workSpeed(pawn, 'construction', world.tickCount) / BUILD[bp.kind].ticks);
    job.progress = bp.work;
    return;
  }
  // Работа готова; стену или плиту нельзя ставить, пока в клетке кто-то стоит.
  if (blocksMovement(bp.kind) && occupied(world, job.target.x, job.target.y)) {
    job.wait = (job.wait ?? 0) + 1;
    if (job.wait > BUILD_WAIT_LIMIT) endJob(world, pawn);
    return;
  }
  world.completeBlueprint(idx);
  endJob(world, pawn);
}

/** Доля выполнения текущего действия 0..1 для полосы прогресса; null — нечего показывать. */
export function jobFraction(pawn: Pawn): number | null {
  const j = pawn.job;
  if (!j) return null;
  if (j.phase === 'act' || j.phase === 'act2') {
    if (j.kind === 'sleep') return Math.min(1, pawn.needs.sleep / NEEDS.sleepWake);
    if (j.kind === 'relax') return Math.min(1, pawn.needs.rest / NEEDS.relaxUntil);
    if (j.kind === 'wander' || j.kind === 'stroll' || j.kind === 'bedrest' || j.kind === 'downed') return null;
    if (j.duration > 0) return Math.min(1, j.progress / j.duration);
  }
  return null;
}

/** Мысли после сна: пол, кровать, своя спальня. */
function onWake(world: World, pawn: Pawn): void {
  const idx = pawn.cy * world.map.width + pawn.cx;
  if (world.map.structure[idx] !== Structure.Bed) {
    addThought(pawn, 'sleptOnFloor', world.tickCount);
    return;
  }
  addThought(pawn, 'sleptInBed', world.tickCount);
  const rooms = world.rooms();
  const id = rooms.roomOf[idx]!;
  if (id >= 0 && rooms.rooms[id]!.beds.length === 1) addThought(pawn, 'ownBedroom', world.tickCount);
}

export function endJob(world: World, pawn: Pawn): void {
  cancelJob(world, pawn);
}

/** Во время работы поселенец смотрит на объект работы (если он не в той же клетке). */
function faceWork(pawn: Pawn, job: Job): void {
  if (['sleep', 'relax', 'wander', 'stroll', 'bedrest', 'downed'].includes(job.kind)) return;
  const t = job.phase === 'act2' && job.dest ? job.dest : job.target;
  if (t.x !== pawn.cx || t.y !== pawn.cy) pawn.facing = Math.atan2(t.y - pawn.cy, t.x - pawn.cx);
}

/** Один тик выполнения текущей задачи. */
export function runJob(world: World, pawn: Pawn): void {
  const job = pawn.job;
  if (!job) return;
  if (!stillValid(world, pawn, job)) {
    endJob(world, pawn);
    return;
  }

  if (job.phase === 'move' || job.phase === 'move2') {
    // Путь мог перекрыть новый чертёж/стена — тогда задачу придётся выбрать заново.
    if (pawn.path.some((c) => !world.map.isPassable(c.x, c.y))) {
      endJob(world, pawn);
      return;
    }
    stepMovement(pawn, world.map, isSick(pawn, world.tickCount) ? SICK.speedFactor : 1);
    if (pawn.path.length === 0 && pawn.t === 0) arrive(world, pawn, job);
    return;
  }

  if (job.kind === 'build') {
    actBuild(world, pawn, job);
    return;
  }
  if (job.kind === 'downed') {
    if (!pawn.downed) endJob(world, pawn);
    return;
  }

  faceWork(pawn, job);
  job.progress++;
  if (job.kind === 'sleep') {
    if (pawn.needs.sleep >= NEEDS.sleepWake) {
      onWake(world, pawn);
      endJob(world, pawn);
    }
  } else if (job.kind === 'relax') {
    if (pawn.needs.rest >= NEEDS.relaxUntil) endJob(world, pawn);
  } else if (job.kind === 'bedrest') {
    if (!needsBedrest(pawn) || job.progress > HEALTH.bedrestMaxTicks) endJob(world, pawn);
  } else if (job.progress >= job.duration) {
    finishAction(world, pawn, job);
  }
}
