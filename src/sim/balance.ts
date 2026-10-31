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

// ---------- Этап 2: поселенцы, нужды, работы ----------

export const PAWN_COUNT = 3;
export const DEFAULT_PRIORITY = 3;
/** Пауза между попытками выбрать задачу, если ничего не нашлось (тики). */
export const THINK_COOLDOWN = 20;

/** Скорость работы от навыка: 0.6 + 0.08 × уровень (навык 5 ≈ 1.0, навык 15 ≈ 1.8). */
export const SKILL_BASE_SPEED = 0.6;
export const SKILL_SPEED_PER_LEVEL = 0.08;
export const STARVING_SPEED_FACTOR = 0.5;

// Предметы
export const STACK_MAX = 50;
export const CARRY_MAX = 25;
export const DROP_SEARCH_RADIUS = 8;
export const WOOD_PER_TREE = 20;
export const STONE_PER_ROCK = 15;

// Ягодные кусты
export const BUSH_COUNT = 30;
export const BUSH_NEAR_START = 8;
export const BUSH_MAX_BERRIES = 6;
export const BUSH_REGROW_TICKS = 600;
/** Собирать ягоды, только пока всего ягод на карте меньше этого числа. */
export const BERRY_STOCK_TARGET = 40;
export const START_BERRIES = 12;
export const BERRY_FOOD = 10;

/** Длительности действий в тиках (при скорости работы 1.0). */
export const WORK_TICKS = {
  chop: 160,
  mine: 240,
  berry: 30, // на каждую ягоду
  pickup: 10,
  drop: 10,
  eat: 60,
} as const;

/** Нужды 0–100. «PerDay» — изменение за игровые сутки (DAY_TICKS тиков). */
export const NEEDS = {
  foodPerDay: 45,
  sleepPerDay: 70,
  restWorkPerDay: 150,
  restIdlePerDay: 200,
  sleepRestorePerDay: 300,
  relaxRestorePerDay: 400,
  foodUrgent: 30,
  foodCritical: 10,
  sleepUrgent: 20,
  sleepCritical: 5,
  restUrgent: 15,
  eatTarget: 95,
  sleepWake: 90,
  relaxUntil: 60,
} as const;
