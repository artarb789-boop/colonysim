import { CLIMATE, DAY_START_HOUR, DAY_TICKS, GROW, NIGHT, SEASON_DAYS, YEAR_DAYS } from './balance';
import { hash2 } from './rng';

export const SEASON_NAMES = ['Весна', 'Лето', 'Осень', 'Зима'] as const;

export interface GameTime {
  /** Номер игровых суток, с 1. */
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

export interface Calendar {
  day: number;
  year: number;
  /** 0 весна, 1 лето, 2 осень, 3 зима. */
  season: number;
  seasonName: string;
  /** День внутри сезона, 1..15. */
  dayInSeason: number;
  hour: number;
  minute: number;
  /** Час суток дробным числом, 0..24. */
  hourFloat: number;
}

export function calendar(tick: number): Calendar {
  const t = gameTime(tick);
  const dayIndex = t.day - 1;
  const inYear = dayIndex % YEAR_DAYS;
  const season = Math.floor(inYear / SEASON_DAYS);
  return {
    day: t.day,
    year: Math.floor(dayIndex / YEAR_DAYS) + 1,
    season,
    seasonName: SEASON_NAMES[season]!,
    dayInSeason: (inYear % SEASON_DAYS) + 1,
    hour: t.hour,
    minute: t.minute,
    hourFloat: t.hour + t.minute / 60,
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Температура на улице, °C. Чистая функция тика и сида. */
export function outdoorTemp(tick: number, seed: number, coldWaveOffset = 0): number {
  const days = tick / DAY_TICKS + DAY_START_HOUR / 24; // дней от полуночи первых суток
  const yearPos = days % YEAR_DAYS;
  const base = CLIMATE.mean + CLIMATE.amp * Math.sin((2 * Math.PI * (yearPos - CLIMATE.phase)) / YEAR_DAYS);
  const hour = (days % 1) * 24;
  const diurnal = CLIMATE.diurnal * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  const d0 = Math.floor(days);
  const f = smooth(days - d0);
  const n = hash2(d0, 1, seed) * (1 - f) + hash2(d0 + 1, 1, seed) * f;
  const noise = (n - 0.5) * 2 * CLIMATE.noise;
  return base + diurnal + noise + coldWaveOffset;
}

/** Температура в замкнутой комнате: смесь комфортной и уличной. */
export function indoorTemp(outdoor: number): number {
  return CLIMATE.indoorBase * CLIMATE.indoorWeight + outdoor * (1 - CLIMATE.indoorWeight);
}

/** Множитель роста растений по температуре. */
export function growthFactor(temp: number): number {
  if (temp < GROW.minTemp) return 0;
  if (temp < GROW.fullTemp) return (temp - GROW.minTemp) / (GROW.fullTemp - GROW.minTemp);
  if (temp <= GROW.hotTemp) return 1;
  return Math.max(GROW.hotFloor, 1 - ((temp - GROW.hotTemp) / 8) * (1 - GROW.hotFloor));
}

export function isNightHour(hourFloat: number): boolean {
  return hourFloat >= NIGHT.start || hourFloat < NIGHT.end;
}

/** Затемнение 0..maxDarkness: самое тёмное около 01:00, светлее всего около 13:00. */
export function darknessAt(tick: number): number {
  const h = calendar(tick).hourFloat;
  const d = (1 + Math.cos((2 * Math.PI * (h - 1)) / 24)) / 2; // 1 в час ночи, 0 в час дня
  const lo = 0.35;
  const hi = 0.85;
  const x = Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
  return smooth(x) * NIGHT.maxDarkness;
}
