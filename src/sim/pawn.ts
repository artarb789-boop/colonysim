import {
  DEFAULT_PRIORITY,
  PAWN_SPEED,
  SKILL_BASE_SPEED,
  SKILL_SPEED_PER_LEVEL,
  STARVING_SPEED_FACTOR,
  TICKS_PER_SECOND,
} from './balance';
import type { Job, WorkType } from './jobs';
import type { Thought } from './mood';
import { WORK_TYPES } from './jobs';
import type { ItemStack } from './items';
import type { GameMap } from './map';
import type { Point } from './pathfinding';
import type { Rng } from './rng';

export type SkillId =
  | 'construction'
  | 'crafting'
  | 'mining'
  | 'cooking'
  | 'plants'
  | 'shooting'
  | 'medicine'
  | 'social'
  | 'intellect';
export const SKILLS: readonly SkillId[] = [
  'construction', 'crafting', 'mining', 'cooking', 'plants', 'shooting', 'medicine', 'social', 'intellect',
];

export interface Needs {
  food: number;
  sleep: number;
  rest: number;
}

export interface Pawn {
  id: number;
  name: string;
  color: string;
  /** Клетка, из которой идём (целые координаты). */
  cx: number;
  cy: number;
  /** Прогресс текущего шага к path[0], 0..1. */
  t: number;
  /** Позиция в координатах клеток (центр клетки = целое число) и на прошлом тике — для интерполяции. */
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  path: Point[];
  /** Куда идём (для маркера на карте). */
  target: Point | null;
  needs: Needs;
  skills: Record<SkillId, number>;
  /** Приоритеты работ: 1 (раньше всего) … 4; 0 — выключено. */
  priorities: Record<WorkType, number>;
  job: Job | null;
  carrying: ItemStack | null;
  thinkCooldown: number;
  /** Мысли-события; настроение складывается из них и состояний нужд. */
  thoughts: Thought[];
  /** Настроение 0–100 (кэш для интерфейса). */
  mood: number;
  /** Идёт срыв до этого тика, иначе null. */
  breakUntil: number | null;
  /** Новый срыв возможен не раньше этого тика. */
  breakCooldownUntil: number;
  /** Клетка закреплённой кровати. */
  ownedBed: number | null;
  /** Куда смотрит поселенец, радианы (0 — вправо, π/2 — вниз). */
  facing: number;
}

export function createPawn(id: number, name: string, color: string, x: number, y: number, rng: Rng): Pawn {
  const skills = {} as Record<SkillId, number>;
  for (const s of SKILLS) skills[s] = rng.int(0, 12);
  const priorities = {} as Record<WorkType, number>;
  for (const w of WORK_TYPES) priorities[w] = DEFAULT_PRIORITY;
  return {
    id,
    name,
    color,
    cx: x,
    cy: y,
    t: 0,
    x,
    y,
    prevX: x,
    prevY: y,
    path: [],
    target: null,
    needs: { food: 100, sleep: 100, rest: 100 },
    skills,
    priorities,
    job: null,
    carrying: null,
    thinkCooldown: 0,
    thoughts: [],
    mood: 50,
    breakUntil: null,
    breakCooldownUntil: 0,
    ownedBed: null,
    facing: Math.PI / 2,
  };
}

/** Множитель скорости работы от уровня навыка. */
export function workSpeed(pawn: Pawn, skill: SkillId): number {
  return SKILL_BASE_SPEED + SKILL_SPEED_PER_LEVEL * pawn.skills[skill];
}

/** Клетка, от которой строится новый путь: если мы посреди шага — та, к которой идём. */
export function originOf(p: Pawn): Point {
  return p.t > 0 && p.path.length > 0 ? p.path[0]! : { x: p.cx, y: p.cy };
}

/** Один тик движения по p.path. */
export function stepMovement(p: Pawn, map: GameMap): void {
  if (p.path.length === 0) return;

  const dir = p.path[0]!;
  if (dir.x !== p.cx || dir.y !== p.cy) p.facing = Math.atan2(dir.y - p.cy, dir.x - p.cx);
  const factor = p.needs.food <= 0 ? STARVING_SPEED_FACTOR : 1;
  let budget = (PAWN_SPEED * factor) / TICKS_PER_SECOND; // «расстояние» стоимостью 1, доступное за тик
  while (budget > 0 && p.path.length > 0) {
    const next = p.path[0]!;
    const diag = next.x !== p.cx && next.y !== p.cy;
    const stepLen = (diag ? Math.SQRT2 : 1) * map.moveCost(next.x, next.y);
    const remaining = (1 - p.t) * stepLen;
    if (budget >= remaining) {
      budget -= remaining;
      p.cx = next.x;
      p.cy = next.y;
      p.t = 0;
      p.path.shift();
    } else {
      p.t += budget / stepLen;
      budget = 0;
    }
  }

  const next = p.path[0];
  if (next) {
    p.x = p.cx + (next.x - p.cx) * p.t;
    p.y = p.cy + (next.y - p.cy) * p.t;
  } else {
    p.x = p.cx;
    p.y = p.cy;
    p.t = 0;
    p.target = null;
  }
}
