import { describe, expect, it } from 'vitest';
import { DAY_TICKS, MAP_SIZE, PAWN_SPEED, TICKS_PER_SECOND } from '../src/sim/balance';
import { gameTime, World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);

function solo(seed = 1): World {
  return new World(seed, { pawnCount: 1, ai: false, startItems: false });
}

function runUntilIdle(w: World, max = 5000): number {
  let n = 0;
  while (w.pawns[0]!.job !== null && n < max) {
    w.tick();
    n++;
  }
  return n;
}

describe('World: движение по приказу «иди сюда»', () => {
  it('три поселенца стартуют в стартовой зоне', () => {
    const w = new World(1);
    expect(w.pawns).toHaveLength(3);
    for (const p of w.pawns) expect(w.map.isPassable(p.cx, p.cy)).toBe(true);
    expect(new Set(w.pawns.map((p) => `${p.cx},${p.cy}`)).size).toBe(3);
  });

  it('moveTo + тики доводят поселенца до цели', () => {
    const w = solo();
    expect(w.moveTo(0, C + 2, C)).toBe(true);
    runUntilIdle(w);
    const p = w.pawns[0]!;
    expect([p.cx, p.cy]).toEqual([C + 2, C]);
    expect(p.target).toBeNull();
  });

  it('скорость соответствует балансу (2 клетки по траве)', () => {
    const w = solo();
    w.moveTo(0, C + 2, C);
    const ticks = runUntilIdle(w);
    const expected = (2 * 1.2 * TICKS_PER_SECOND) / PAWN_SPEED;
    expect(Math.abs(ticks - expected)).toBeLessThanOrEqual(2);
  });

  it('за тик позиция меняется плавно, prev хранит прошлую', () => {
    const w = solo();
    w.moveTo(0, C + 2, C);
    w.tick();
    const p = w.pawns[0]!;
    expect(p.prevX).toBe(C);
    expect(p.x).toBeGreaterThan(C);
    expect(p.x).toBeLessThan(C + 1);
    const x1 = p.x;
    w.tick();
    expect(p.prevX).toBe(x1);
  });

  it('недостижимая или непроходимая цель игнорируется', () => {
    const w = solo();
    w.moveTo(0, C + 1, C);
    const before = JSON.stringify(w.pawns[0]);
    expect(w.moveTo(0, -1, -1)).toBe(false);
    expect(w.moveTo(0, 999, 0)).toBe(false);
    expect(JSON.stringify(w.pawns[0])).toBe(before);
    let bad: [number, number] | null = null;
    for (let y = 0; y < MAP_SIZE && !bad; y++)
      for (let x = 0; x < MAP_SIZE && !bad; x++) if (!w.map.isPassable(x, y)) bad = [x, y];
    expect(w.moveTo(0, bad![0], bad![1])).toBe(false);
  });

  it('смена цели посреди шага не телепортирует поселенца', () => {
    const w = solo();
    w.moveTo(0, C + 3, C);
    w.tick();
    const p = w.pawns[0]!;
    const { x, y } = p;
    expect(x).toBeGreaterThan(C);
    w.moveTo(0, C - 3, C);
    expect(p.x).toBe(x);
    expect(p.y).toBe(y);
    expect(p.path[0]).toEqual({ x: C + 1, y: C });
    runUntilIdle(w);
    expect(p.cx).toBe(C - 3);
  });

  it('без приказа и без ИИ поселенец стоит', () => {
    const w = solo();
    for (let i = 0; i < 50; i++) w.tick();
    expect([w.pawns[0]!.x, w.pawns[0]!.y]).toEqual([C, C]);
  });

  it('детерминизм: одинаковый сид и команды — одинаковый результат (с ИИ)', () => {
    const run = () => {
      const w = new World(77);
      w.applyOrder('chop', C - 8, C - 8, C + 8, C + 8);
      w.applyOrder('zone', C - 2, C + 3, C + 2, C + 4);
      for (let i = 0; i < 600; i++) w.tick();
      w.moveTo(1, C - 2, C - 2);
      for (let i = 0; i < 600; i++) w.tick();
      return JSON.stringify([w.pawns, [...w.items.stacks], [...w.designations], w.tickCount]);
    };
    expect(run()).toBe(run());
  });
});

describe('gameTime', () => {
  it('день 1 начинается в 06:00', () => {
    expect(gameTime(0)).toEqual({ day: 1, hour: 6, minute: 0 });
  });
  it('полдень через четверть суток', () => {
    expect(gameTime(DAY_TICKS / 4)).toEqual({ day: 1, hour: 12, minute: 0 });
  });
  it('перевал через полночь меняет день', () => {
    expect(gameTime(DAY_TICKS * 0.75).hour).toBe(0);
    expect(gameTime(DAY_TICKS * 0.75).day).toBe(2);
  });
  it('следующие сутки', () => {
    expect(gameTime(DAY_TICKS).day).toBe(2);
    expect(gameTime(DAY_TICKS).hour).toBe(6);
  });
});

describe('направление взгляда', () => {
  it('при ходьбе смотрит по ходу движения', () => {
    const w = solo();
    w.moveTo(0, C + 3, C);
    w.tick();
    expect(w.pawns[0]!.facing).toBeCloseTo(0); // вправо
    const w2 = solo();
    w2.moveTo(0, C, C - 3);
    w2.tick();
    expect(w2.pawns[0]!.facing).toBeCloseTo(-Math.PI / 2); // вверх
    const w3 = solo();
    w3.moveTo(0, C - 3, C + 3);
    w3.tick();
    expect(w3.pawns[0]!.facing).toBeCloseTo((3 * Math.PI) / 4); // вниз-влево
  });

  it('при работе смотрит на объект и сохраняет взгляд после остановки', () => {
    const w = new World(5, { pawnCount: 1, startItems: false });
    for (let y = C - 8; y <= C + 8; y++) for (let x = C - 8; x <= C + 8; x++) w.map.set(x, y, 0);
    w.map.bushes.clear();
    w.map.set(C, C - 3, 4); // дерево над поселенцем
    w.applyOrder('chop', C, C - 3, C, C - 3);
    for (let i = 0; i < 40; i++) w.tick();
    expect(w.pawns[0]!.job?.kind).toBe('chop');
    expect(w.pawns[0]!.facing).toBeCloseTo(-Math.PI / 2);
  });

  it('взгляд переживает сохранение', async () => {
    const { serializeWorld, restoreWorld } = await import('../src/sim/serialize');
    const w = solo();
    w.moveTo(0, C + 3, C);
    w.tick();
    expect(restoreWorld(serializeWorld(w))!.pawns[0]!.facing).toBeCloseTo(0);
  });
});
