import { COMBAT } from './balance';
import { engage } from './combat';
import { createPawn, stepMovement, type Pawn } from './pawn';
import { findPath, findPathToAny, type Point } from './pathfinding';
import type { World } from './world';

/** Визуальный эффект удара/выстрела; живёт несколько тиков, в сохранение не входит. */
export interface Fx {
  kind: 'swing' | 'shot';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  hit: boolean;
  until: number;
}

const NAMES = ['Гром', 'Шрам', 'Волк', 'Клык', 'Ворон', 'Седой', 'Костя', 'Бес', 'Лютый', 'Рвач'] as const;
const RAIDER_COLOR = '#C0392B';
const ENEMY_ID_BASE = 1000;

/** Размер ближайшего набега: растёт с числом отбитых набегов и размером колонии. */
export function raidSize(world: World): { count: number; bows: number } {
  const done = world.story.raidsDone;
  const extra = Math.max(0, Math.floor((world.living.length - 3) / 2));
  const count = Math.min(COMBAT.raidMaxSize, 2 + Math.floor(done / 2) + extra);
  return { count, bows: done >= 2 ? Math.floor(count / 3) : 0 };
}

function edgeCell(world: World): Point {
  const w = world.map.width;
  const h = world.map.height;
  const side = world.rng.int(0, 3);
  const k = world.rng.int(1, (side < 2 ? w : h) - 2);
  return side === 0 ? { x: k, y: 0 } : side === 1 ? { x: k, y: h - 1 } : side === 2 ? { x: 0, y: k } : { x: w - 1, y: k };
}

/** Появление налётчиков на краю карты, откуда есть дорога к колонии. */
export function spawnRaid(world: World, count: number, bows: number): boolean {
  const cx = Math.floor(world.map.width / 2);
  const cy = Math.floor(world.map.height / 2);
  let start: Point | null = null;
  for (let i = 0; i < 40 && !start; i++) {
    const c = edgeCell(world);
    if (world.map.isPassable(c.x, c.y) && findPath(world.map, c.x, c.y, cx, cy)) start = c;
  }
  if (!start) return false;
  // отряд кучкой возле точки появления
  const cells: Point[] = [start];
  for (let r = 1; r < 6 && cells.length < count; r++)
    for (let dy = -r; dy <= r && cells.length < count; dy++)
      for (let dx = -r; dx <= r && cells.length < count; dx++) {
        const x = start.x + dx;
        const y = start.y + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && world.map.isPassable(x, y)) cells.push({ x, y });
      }
  for (let i = 0; i < Math.min(count, cells.length); i++) {
    const at = cells[i]!;
    const e = createPawn(ENEMY_ID_BASE + world.nextEnemyId++, world.rng.pick(NAMES), RAIDER_COLOR, at.x, at.y, world.rng);
    e.faction = 'raider';
    e.traits = [];
    e.weapon = i < bows ? 'bow' : 'club';
    e.skills.shooting = world.rng.int(COMBAT.raiderSkillMin, COMBAT.raiderSkillMax);
    world.enemies.push(e);
  }
  return true;
}

/** Все выходы: ближайшая по прямой клетка может быть закрыта или недостижима. */
function edgeGoals(world: World): Point[] {
  const w = world.map.width - 1;
  const h = world.map.height - 1;
  const goals: Point[] = [];
  for (let x = 0; x <= w; x++) goals.push({ x, y: 0 }, { x, y: h });
  for (let y = 1; y < h; y++) goals.push({ x: 0, y }, { x: w, y });
  return goals;
}

const onEdge = (world: World, e: Pawn): boolean =>
  e.cx === 0 || e.cy === 0 || e.cx === world.map.width - 1 || e.cy === world.map.height - 1;

/** Ближайший живой колонист; сначала те, кто на ногах. */
function pickTarget(world: World, e: Pawn): Pawn | null {
  let best: Pawn | null = null;
  let bestScore = Infinity;
  for (const p of world.pawns) {
    if (p.dead || p.carriedBy !== null) continue;
    const score = Math.hypot(p.x - e.x, p.y - e.y) + (p.downed ? 1000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** Один тик налётчиков: бой, бегство, уборка трупов, конец набега. */
export function tickEnemies(world: World): void {
  const enemies = world.enemies;
  if (enemies.length === 0) return;
  const story = world.story;

  for (const e of enemies) {
    if (e.dead) continue;
    e.prevX = e.x;
    e.prevY = e.y;
    if (e.attackCooldown > 0) e.attackCooldown--;
    if (e.downed) continue;
    if (e.fleeing) {
      if (--e.aiTimer <= 0 || e.path.length === 0) {
        e.aiTimer = 30;
        const goals = edgeGoals(world);
        const midStep = e.t > 0 && e.path.length > 0;
        const o = midStep ? e.path[0]! : { x: e.cx, y: e.cy };
        const rest = findPathToAny(world.map, o.x, o.y, goals);
        e.path = rest ? (midStep ? [o, ...rest] : rest) : midStep ? [o] : [];
        e.target = e.path.length > 0 ? e.path[e.path.length - 1]! : null;
      }
      stepMovement(e, world.map);
      continue;
    }
    const t = pickTarget(world, e);
    if (t) engage(world, e, t);
  }

  // убежавшие уходят с карты, старые трупы убираются
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]!;
    if (e.dead && world.tickCount - e.deathTick > COMBAT.enemyCorpseTicks) enemies.splice(i, 1);
    else if (e.fleeing && !e.dead && !e.downed && onEdge(world, e) && e.t === 0) {
      enemies.splice(i, 1);
      story.raidFled = true;
    }
  }

  // отступление: выбыла часть отряда
  if (story.raidActive && !enemies.some((e) => e.fleeing)) {
    const out = enemies.filter((e) => e.dead || e.downed).length;
    if (enemies.length > 0 && out >= Math.ceil(enemies.length * COMBAT.fleeFraction) && enemies.some((e) => !e.dead && !e.downed)) {
      for (const e of enemies) if (!e.dead && !e.downed) e.fleeing = true;
      world.addLog('Налётчики обратились в бегство');
    }
  }

  // конец набега: на карте не осталось боеспособных налётчиков
  if (story.raidActive && !enemies.some((e) => !e.dead && !e.downed)) {
    story.raidActive = false;
    story.raidsDone++;
    world.addLog(story.raidFled ? 'Налётчики ушли — набег закончился' : 'Набег отбит');
    story.raidFled = false;
    if (world.alarmAuto) {
      world.alarm = false;
      world.alarmAuto = false;
    }
  }
}


