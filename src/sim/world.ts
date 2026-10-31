import {
  DAY_START_HOUR,
  DAY_TICKS,
  MAP_SIZE,
  PAWN_SPEED,
  TICKS_PER_SECOND,
} from './balance';
import { GameMap, generateMap } from './map';
import { findPath, type Point } from './pathfinding';

export interface Pawn {
  name: string;
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
  target: Point | null;
}

export class World {
  readonly map: GameMap;
  readonly pawn: Pawn;
  tickCount = 0;

  constructor(readonly seed: number) {
    this.map = generateMap(seed);
    const c = Math.floor(MAP_SIZE / 2);
    this.pawn = {
      name: 'Аня',
      cx: c,
      cy: c,
      t: 0,
      x: c,
      y: c,
      prevX: c,
      prevY: c,
      path: [],
      target: null,
    };
  }

  /** Приказ «иди сюда». Возвращает false, если цель непроходима или недостижима. */
  moveTo(tx: number, ty: number): boolean {
    const p = this.pawn;
    // Если мы посреди шага — сначала доходим до клетки, к которой идём.
    const midStep = p.t > 0 && p.path.length > 0;
    const origin: Point = midStep ? p.path[0]! : { x: p.cx, y: p.cy };
    const rest = findPath(this.map, origin.x, origin.y, tx, ty);
    if (rest === null) return false;
    p.path = midStep ? [origin, ...rest] : rest;
    p.target = p.path.length > 0 ? { x: tx, y: ty } : null;
    return true;
  }

  tick(): void {
    this.tickCount++;
    const p = this.pawn;
    p.prevX = p.x;
    p.prevY = p.y;
    if (p.path.length === 0) return;

    let budget = PAWN_SPEED / TICKS_PER_SECOND; // «расстояние» стоимостью 1, доступное за тик
    while (budget > 0 && p.path.length > 0) {
      const next = p.path[0]!;
      const diag = next.x !== p.cx && next.y !== p.cy;
      const stepLen = (diag ? Math.SQRT2 : 1) * this.map.moveCost(next.x, next.y);
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
