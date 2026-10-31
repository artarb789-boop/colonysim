// Все числа баланса — здесь (см. правила в CLAUDE.md).

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Множители скорости: 0 = пауза, затем 1×, 2×, 3×. */
export const SPEED_MULTIPLIERS = [0, 1, 2, 3] as const;
/** Защита от «спирали смерти»: максимум тиков за один кадр. */
export const MAX_TICKS_PER_FRAME = 30;

/** Длина игровых суток в тиках (3 минуты реального времени на 1×). */
export const DAY_TICKS = 3600;
export const DAY_START_HOUR = 6;

export const MAP_SIZE = 60;
/** Радиус стартовой зоны вокруг центра (всегда проходима, без деревьев). */
export const START_ZONE_RADIUS = 2;

/** Скорость поселенца: клеток в секунду при стоимости клетки 1. */
export const PAWN_SPEED = 3;

/** Стоимость прохода по клетке (больше = медленнее). Infinity — непроходимо. */
export const MOVE_COST = {
  grass: 1.2,
  dirt: 1.0,
  stone: Infinity,
  water: Infinity,
  tree: Infinity,
} as const;
