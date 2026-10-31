import { describe, expect, it } from 'vitest';
import { DAY_TICKS, MAP_SIZE, PAWN_SPEED, TICKS_PER_SECOND } from '../src/sim/balance';
import { gameTime, World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);

function runUntilIdle(w: World, max = 5000): number {
  let n = 0;
  while (w.pawn.path.length > 0 && n < max) {
    w.tick();
    n++;
  }
  return n;
}

describe('World', () => {
  it('поселенец стартует в центре', () => {
    const w = new World(1);
    expect(w.pawn.cx).toBe(C);
    expect(w.pawn.cy).toBe(C);
    expect(w.map.isPassable(C, C)).toBe(true);
  });

  it('moveTo + тики доводят поселенца до цели', () => {
    const w = new World(1);
    expect(w.moveTo(C + 2, C)).toBe(true);
    runUntilIdle(w);
    expect(w.pawn.cx).toBe(C + 2);
    expect(w.pawn.cy).toBe(C);
    expect(w.pawn.target).toBeNull();
  });

  it('скорость соответствует балансу (2 клетки по траве)', () => {
    const w = new World(1);
    w.moveTo(C + 2, C);
    const ticks = runUntilIdle(w);
    // трава стоимостью 1.2: 2 клетки = 2.4 «расстояния»
    const expected = (2 * 1.2 * TICKS_PER_SECOND) / PAWN_SPEED;
    expect(Math.abs(ticks - expected)).toBeLessThanOrEqual(1);
  });

  it('за тик позиция меняется плавно, prev хранит прошлую', () => {
    const w = new World(1);
    w.moveTo(C + 2, C);
    w.tick();
    expect(w.pawn.prevX).toBe(C);
    expect(w.pawn.x).toBeGreaterThan(C);
    expect(w.pawn.x).toBeLessThan(C + 1);
    const x1 = w.pawn.x;
    w.tick();
    expect(w.pawn.prevX).toBe(x1);
  });

  it('недостижимая или непроходимая цель игнорируется', () => {
    const w = new World(1);
    w.moveTo(C + 1, C);
    const before = JSON.stringify(w.pawn);
    expect(w.moveTo(-1, -1)).toBe(false);
    expect(w.moveTo(999, 0)).toBe(false);
    expect(JSON.stringify(w.pawn)).toBe(before);
    // найдём любую непроходимую клетку
    let bad: [number, number] | null = null;
    for (let y = 0; y < MAP_SIZE && !bad; y++)
      for (let x = 0; x < MAP_SIZE && !bad; x++) if (!w.map.isPassable(x, y)) bad = [x, y];
    expect(bad).not.toBeNull();
    expect(w.moveTo(bad![0], bad![1])).toBe(false);
  });

  it('смена цели посреди шага не телепортирует поселенца', () => {
    const w = new World(1);
    w.moveTo(C + 3, C);
    w.tick();
    const { x, y } = w.pawn;
    expect(x).toBeGreaterThan(C);
    w.moveTo(C - 3, C);
    // позиция не прыгнула; клетка, к которой шли, достигается первой
    expect(w.pawn.x).toBe(x);
    expect(w.pawn.y).toBe(y);
    expect(w.pawn.path[0]).toEqual({ x: C + 1, y: C });
    runUntilIdle(w);
    expect(w.pawn.cx).toBe(C - 3);
  });

  it('детерминизм: одинаковый сид и команды — одинаковый результат', () => {
    const run = () => {
      const w = new World(77);
      w.moveTo(C + 4, C + 3);
      for (let i = 0; i < 100; i++) w.tick();
      w.moveTo(C - 2, C - 2);
      for (let i = 0; i < 100; i++) w.tick();
      return JSON.stringify(w.pawn);
    };
    expect(run()).toBe(run());
  });

  it('без приказа поселенец стоит', () => {
    const w = new World(1);
    for (let i = 0; i < 50; i++) w.tick();
    expect(w.pawn.x).toBe(C);
    expect(w.pawn.y).toBe(C);
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
