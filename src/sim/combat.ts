import { COMBAT, WEAPONS } from './balance';
import { BODY_PARTS, workFactor, type BodyPart } from './health';
import { Structure, Terrain, type GameMap } from './map';
import { findPathToAny, type Point } from './pathfinding';
import { stepMovement, type Pawn } from './pawn';
import type { Rng } from './rng';
import type { World } from './world';

export type WeaponDef = (typeof WEAPONS)[keyof typeof WEAPONS];

export function weaponDef(p: Pawn): WeaponDef {
  return WEAPONS[p.weapon ?? 'fists'];
}

export interface Los {
  /** Нет стены или скалы между стрелком и целью. */
  clear: boolean;
  /** Прямо перед целью стоит плита, кровать, дверь или дерево — цель прикрыта. */
  cover: boolean;
}

/** Линия по клеткам (Брезенхэм). Стены и скалы закрывают обзор; плита, кровать, дверь и дерево — укрытие. */
export function los(map: GameMap, x0: number, y0: number, x1: number, y1: number): Los {
  let dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  let prev: Point | null = null;
  let clear = true;
  dx = Math.abs(x1 - x0);
  for (let guard = 0; guard < 200 && !(x === x1 && y === y1); guard++) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) break;
    const i = y * map.width + x;
    if (!map.inBounds(x, y) || map.structure[i] === Structure.Wall || map.cells[i] === Terrain.Stone) {
      clear = false;
      break;
    }
    prev = { x, y };
  }
  let cover = false;
  if (clear && prev) {
    const i = prev.y * map.width + prev.x;
    const s = map.structure[i];
    cover = s === Structure.Stove || s === Structure.Bed || s === Structure.Door || map.cells[i] === Terrain.Tree;
  }
  return { clear, cover };
}

/** Вероятность попасть. */
export function hitChance(attacker: Pawn, dist: number, cover: boolean): number {
  const def = weaponDef(attacker);
  let p: number = COMBAT.meleeHit;
  if (!def.melee) {
    p = COMBAT.rangedBase + attacker.skills.shooting * COMBAT.rangedPerSkill - dist * COMBAT.rangedPerCell;
    p = Math.min(COMBAT.rangedMax, Math.max(COMBAT.rangedMin, p));
  }
  p *= 0.5 + 0.5 * workFactor(attacker); // раненые руки и боль мешают
  return cover && !def.melee ? p * COMBAT.coverFactor : p;
}

export function pickPart(rng: Rng): BodyPart {
  const w = COMBAT.partWeights;
  const total = BODY_PARTS.reduce((a, p) => a + w[p], 0);
  let roll = rng.next() * total;
  for (const p of BODY_PARTS) {
    roll -= w[p];
    if (roll < 0) return p;
  }
  return 'torso';
}

const dist = (a: Pawn, b: Pawn): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Хватает ли дальности и видимости, чтобы ударить или выстрелить прямо сейчас. */
export function inReach(world: World, a: Pawn, t: Pawn): { ok: boolean; cover: boolean; d: number } {
  const def = weaponDef(a);
  const d = dist(a, t);
  if (d > def.range) return { ok: false, cover: false, d };
  if (def.melee) return { ok: true, cover: false, d };
  const l = los(world.map, a.cx, a.cy, t.cx, t.cy);
  return { ok: l.clear, cover: l.cover, d };
}

/** Удар или выстрел; урон наносится сразу. Возвращает true, если атака состоялась (попал или промахнулся). */
export function attack(world: World, a: Pawn, t: Pawn, cover: boolean, d: number): boolean {
  const def = weaponDef(a);
  a.attackCooldown = def.cooldown;
  a.facing = Math.atan2(t.y - a.y, t.x - a.x);
  const hit = world.rng.next() < hitChance(a, d, cover);
  world.addFx(def.melee ? 'swing' : 'shot', a, t, hit);
  if (hit) {
    const part = pickPart(world.rng);
    const dmg = world.rng.int(def.min, def.max);
    world.hurt(t, part, def.kind, dmg);
  }
  return true;
}

function adjacentPassable(map: GameMap, p: Point): Point[] {
  const out: Point[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && map.isPassable(p.x + dx, p.y + dy)) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

/** Строит путь от текущей позиции (с учётом недоделанного шага). */
function repath(world: World, a: Pawn, goals: readonly Point[]): void {
  const midStep = a.t > 0 && a.path.length > 0;
  const o = midStep ? a.path[0]! : { x: a.cx, y: a.cy };
  const rest = findPathToAny(world.map, o.x, o.y, goals);
  a.path = rest ? (midStep ? [o, ...rest] : rest) : midStep ? [o] : [];
  a.target = a.path.length > 0 ? a.path[a.path.length - 1]! : null;
}

/**
 * Один тик боя против цели: бить/стрелять, если можно, иначе идти к ней.
 * Ближнему нужно встать рядом, дальнему — подойти на дистанцию выстрела при прямой видимости.
 */
export function engage(world: World, a: Pawn, t: Pawn): void {
  const reach = inReach(world, a, t);
  if (reach.ok) {
    if (a.path.length > 0 && a.t === 0) a.path = []; // дошли — стоим
    a.facing = Math.atan2(t.y - a.y, t.x - a.x);
    if (a.attackCooldown <= 0) attack(world, a, t, reach.cover, reach.d);
    if (a.path.length > 0) stepMovement(a, world.map);
    return;
  }
  if (--a.aiTimer <= 0 || a.path.length === 0) {
    a.aiTimer = COMBAT.repath;
    const goal = { x: t.cx, y: t.cy };
    repath(world, a, weaponDef(a).melee ? adjacentPassable(world.map, goal) : [goal, ...adjacentPassable(world.map, goal)]);
  }
  stepMovement(a, world.map);
}
