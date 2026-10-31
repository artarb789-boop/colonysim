import {
  BERRY_STOCK_TARGET,
  BUILD,
  BUILD_WAIT_LIMIT,
  BUSH_REGROW_TICKS,
  CARRY_MAX,
  CROP,
  DECONSTRUCT,
  FOOD_VALUE,
  NEEDS,
  STONE_PER_ROCK,
  WOOD_PER_TREE,
  WORK_TICKS,
} from './balance';
import { blocksMovement, kindOfStructure, type BuildKind } from './build';
import { isFood, type ItemKind } from './items';
import { Structure, Terrain } from './map';
import { findPath, findPathToAny, pathCost, type Point } from './pathfinding';
import { originOf, stepMovement, workSpeed, type Pawn, type SkillId } from './pawn';
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
export const IMPLEMENTED_WORKS: readonly WorkType[] = ['construction', 'plants', 'mining', 'hauling'];

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
  | 'eat'
  | 'sleep'
  | 'relax'
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
}

/** Слои резервирования: один объект — один исполнитель. */
export const Layer = { Designation: 0, Bush: 1, Item: 2, Dest: 3, Blueprint: 4, Crop: 5 } as const;
export type LayerId = (typeof Layer)[keyof typeof Layer];

export interface Plan {
  job: Job;
  path: Point[];
  cost: number;
  reserve: [LayerId, number][];
}

/** Задачи, которые можно прервать срочной нуждой. */
export const WORK_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  'chop', 'mine', 'harvest', 'sow', 'reap', 'haul', 'deliver', 'build', 'deconstruct',
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

const PLANNERS: Partial<Record<WorkType, (world: World, pawn: Pawn) => Plan | null>> = {
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
  const stacks: number[] = [];
  for (const [idx, s] of world.items.stacks) {
    if (isFood(s.kind) && s.count > 0 && world.isFree(Layer.Item, idx, pawn.id)) stacks.push(idx);
  }
  const fromStack = bestOf(
    stacks,
    (idx) => pointOf(world, idx),
    originOf(pawn),
    (idx) => {
      const target = pointOf(world, idx);
      const r = route(world, pawn, [target]);
      if (!r) return null;
      return {
        job: { kind: 'eat', phase: 'move', target, source: 'stack', progress: 0, duration: 0 },
        path: r.path,
        cost: r.cost,
        reserve: [[Layer.Item, idx]],
      };
    },
  );
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
function planStay(pawn: Pawn, kind: 'sleep' | 'relax'): Plan {
  const o = originOf(pawn);
  const midStep = pawn.t > 0 && pawn.path.length > 0;
  return {
    job: { kind, phase: 'move', target: o, progress: 0, duration: 0 },
    path: midStep ? [o] : [],
    cost: 0,
    reserve: [],
  };
}

/** Срочные нужды: еда, затем сон, затем отдых. */
export function planUrgent(world: World, pawn: Pawn): Plan | null {
  const n = pawn.needs;
  if (n.food < NEEDS.foodUrgent) {
    const p = planEat(world, pawn);
    if (p) return p;
  }
  if (n.sleep < NEEDS.sleepUrgent) return planStay(pawn, 'sleep');
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
  if (n.sleep <= NEEDS.sleepCritical) return planStay(pawn, 'sleep');
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
  if (pawn.carrying) {
    world.items.drop(pawn.carrying.kind, pawn.carrying.count, pawn.cx, pawn.cy);
    pawn.carrying = null;
  }
  pawn.job = null;
  pawn.target = null;
  pawn.thinkCooldown = 0;
  pawn.path = pawn.t > 0 && pawn.path.length > 0 ? [pawn.path[0]!] : [];
}

function stillValid(world: World, job: Job): boolean {
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
  const speed = skill ? workSpeed(pawn, skill) : 1;
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
      if (job.phase === 'move') {
        job.phase = 'act';
        job.duration = WORK_TICKS.pickup;
      } else {
        job.phase = 'act2';
        job.duration = WORK_TICKS.drop;
      }
      return;
    case 'eat':
      job.phase = 'act';
      job.duration = WORK_TICKS.eat;
      return;
    case 'sleep':
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
      endJob(world, pawn);
      return;
    }
    case 'haul':
    case 'deliver':
      if (job.phase === 'act') pickUp(world, pawn, job);
      else dropAtDest(world, pawn, job);
      return;
    default:
      return;
  }
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
  if (job.kind === 'deliver') {
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
  const path = findPath(world.map, pawn.cx, pawn.cy, dest.x, dest.y);
  if (!path) {
    endJob(world, pawn); // ношу уронит cancelJob
    return;
  }
  pawn.path = path;
  pawn.target = dest;
  job.phase = 'move2';
  job.progress = 0;
  job.duration = 0;
}

function dropAtDest(world: World, pawn: Pawn, job: Job): void {
  const c = pawn.carrying;
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
  return world.pawns.some((p) => (p.cx === x && p.cy === y) || (p.path[0]?.x === x && p.path[0]?.y === y));
}

function actBuild(world: World, pawn: Pawn, job: Job): void {
  const idx = idxOf(world, job.target);
  const bp = world.blueprints.get(idx)!;
  if (bp.work < 1) {
    bp.work = Math.min(1, bp.work + workSpeed(pawn, 'construction') / BUILD[bp.kind].ticks);
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

export function endJob(world: World, pawn: Pawn): void {
  cancelJob(world, pawn);
}

/** Один тик выполнения текущей задачи. */
export function runJob(world: World, pawn: Pawn): void {
  const job = pawn.job;
  if (!job) return;
  if (!stillValid(world, job)) {
    endJob(world, pawn);
    return;
  }

  if (job.phase === 'move' || job.phase === 'move2') {
    // Путь мог перекрыть новый чертёж/стена — тогда задачу придётся выбрать заново.
    if (pawn.path.some((c) => !world.map.isPassable(c.x, c.y))) {
      endJob(world, pawn);
      return;
    }
    stepMovement(pawn, world.map);
    if (pawn.path.length === 0 && pawn.t === 0) arrive(world, pawn, job);
    return;
  }

  if (job.kind === 'build') {
    actBuild(world, pawn, job);
    return;
  }

  job.progress++;
  if (job.kind === 'sleep') {
    if (pawn.needs.sleep >= NEEDS.sleepWake) endJob(world, pawn);
  } else if (job.kind === 'relax') {
    if (pawn.needs.rest >= NEEDS.relaxUntil) endJob(world, pawn);
  } else if (job.progress >= job.duration) {
    finishAction(world, pawn, job);
  }
}
