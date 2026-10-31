import { COLD_WAVE, SICK, STORY } from './balance';
import { calendar } from './climate';
import { createPawn, isSick, SKILLS, type Pawn } from './pawn';
import type { Point } from './pathfinding';
import type { World } from './world';

/** Состояние рассказчика. Всё хранится в сохранении. */
export interface Story {
  nextEventTick: number;
  /** Холодная волна идёт до этого тика; 0 — нет. */
  coldWaveUntil: number;
  /** Торговец присутствует до этого тика. */
  trader: { until: number } | null;
  /** Странник, ждущий решения игрока. */
  pending: { pawn: Pawn; until: number } | null;
}

export interface LogEntry {
  tick: number;
  text: string;
}

const NAMES = [
  'Игнат', 'Мирра', 'Тимур', 'Лада', 'Ян', 'Зоя', 'Савва', 'Нина', 'Роман', 'Алёна', 'Фёдор', 'Рада',
  'Платон', 'Дарья', 'Артём', 'Ева', 'Кирилл', 'Злата', 'Матвей', 'Ясна',
] as const;
const COLORS = ['#E8A33D', '#5AA9E6', '#C58BE0', '#8FBF5A', '#F0A35E', '#F08A7E'] as const;

export function initStory(rngInt: (min: number, max: number) => number, fromTick: number): Story {
  return {
    nextEventTick: fromTick + rngInt(STORY.firstMin, STORY.firstMax),
    coldWaveUntil: 0,
    trader: null,
    pending: null,
  };
}

/** Новый странник: обычный поселенец с парой выдающихся навыков. */
function makeStranger(world: World): Pawn {
  const used = new Set(world.pawns.map((p) => p.name));
  const free = NAMES.filter((n) => !used.has(n));
  const name = world.rng.pick(free.length > 0 ? free : NAMES);
  const color = COLORS[world.pawns.length % COLORS.length]!;
  const pawn = createPawn(-1, name, color, 0, 0, world.rng);
  for (let i = 0; i < 2; i++) {
    const skill = world.rng.pick(SKILLS);
    pawn.skills[skill] = Math.min(20, pawn.skills[skill] + 5);
  }
  return pawn;
}

/** Клетка около центра, свободная от поселенцев. */
function findSpawn(world: World): Point {
  const c = Math.floor(world.map.width / 2);
  for (let r = 0; r < 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = c + dx;
        const y = c + dy;
        if (world.map.isPassable(x, y) && !world.pawns.some((p) => !p.dead && p.cx === x && p.cy === y)) return { x, y };
      }
    }
  }
  return { x: c, y: c };
}

export function acceptStranger(world: World): boolean {
  const pending = world.story.pending;
  if (!pending) return false;
  const p = pending.pawn;
  const at = findSpawn(world);
  p.id = world.pawns.length;
  p.cx = p.x = p.prevX = at.x;
  p.cy = p.y = p.prevY = at.y;
  world.pawns.push(p);
  world.story.pending = null;
  world.addLog(`В колонию принят: ${p.name}`);
  return true;
}

export function declineStranger(world: World): boolean {
  const pending = world.story.pending;
  if (!pending) return false;
  world.story.pending = null;
  world.addLog(`Странник ${pending.pawn.name} ушёл дальше`);
  return true;
}

export type EventId = 'stranger' | 'coldWave' | 'illness' | 'trader';

function weights(world: World): [EventId, number][] {
  const season = calendar(world.tickCount).season;
  const healthy = world.living.filter((p) => !isSick(p, world.tickCount));
  return [
    ['stranger', world.living.length < STORY.maxPawns && !world.story.pending ? 3 : 0],
    ['coldWave', world.story.coldWaveUntil > world.tickCount ? 0 : [1, 0, 2, 4][season]!],
    ['illness', healthy.length > 0 ? 2 : 0],
    ['trader', world.story.trader ? 0 : 2],
  ];
}

/** Запустить событие вручную (для тестирования). Возвращает false, если сейчас оно невозможно. */
export function fireEvent(world: World, id: EventId): boolean {
  const ok = weights(world).find(([e]) => e === id)?.[1] ?? 0;
  const allowed = id === 'coldWave' ? world.story.coldWaveUntil <= world.tickCount : ok > 0;
  if (!allowed) return false;
  fire(world, id);
  return true;
}

function fire(world: World, id: EventId): void {
  const tick = world.tickCount;
  switch (id) {
    case 'stranger': {
      const pawn = makeStranger(world);
      world.story.pending = { pawn, until: tick + STORY.strangerWait };
      world.addLog(`К колонии подошёл странник ${pawn.name} и просит приюта`);
      return;
    }
    case 'coldWave':
      world.story.coldWaveUntil = tick + COLD_WAVE.days * 3600;
      world.invalidateTemp();
      world.addLog(`Холодная волна: ${COLD_WAVE.days} дня сильного холода`);
      return;
    case 'illness': {
      const healthy = world.living.filter((p) => !isSick(p, tick));
      const p = world.rng.pick(healthy);
      p.sickUntil = tick + world.rng.int(SICK.minTicks, SICK.maxTicks);
      world.addLog(`Простуда — ${p.name}`);
      return;
    }
    case 'trader':
      world.story.trader = { until: tick + STORY.traderTicks };
      world.addLog('Прибыл торговец, он пробудет 3 дня');
      return;
  }
}

/** Один тик рассказчика: окончания событий и выбор нового. */
export function tickStory(world: World): void {
  const s = world.story;
  const tick = world.tickCount;
  if (s.pending && tick >= s.pending.until) declineStranger(world);
  if (s.trader && tick >= s.trader.until) {
    s.trader = null;
    world.addLog('Торговец ушёл');
  }
  if (s.coldWaveUntil > 0 && tick >= s.coldWaveUntil) {
    s.coldWaveUntil = 0;
    world.invalidateTemp();
    world.addLog('Холодная волна закончилась');
  }
  if (tick < s.nextEventTick) return;

  const ws = weights(world);
  const total = ws.reduce((a, [, w]) => a + w, 0);
  s.nextEventTick = tick + world.rng.int(STORY.gapMin, STORY.gapMax);
  if (total <= 0) return;
  let roll = world.rng.next() * total;
  for (const [id, w] of ws) {
    roll -= w;
    if (roll < 0 && w > 0) {
      fire(world, id);
      return;
    }
  }
}
