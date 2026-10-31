import { describe, expect, it } from 'vitest';
import { MAP_SIZE } from '../src/sim/balance';
import { SAVE_VERSION, restoreWorld, serializeWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);

function busyWorld(seed = 42): World {
  const w = new World(seed);
  w.applyOrder('chop', C - 8, C - 8, C + 8, C + 8);
  w.applyOrder('mine', C - 8, C - 8, C + 8, C + 8);
  w.applyOrder('zone', C - 3, C + 3, C + 3, C + 5);
  w.setPriority(1, 'mining', 1);
  w.setPriority(2, 'plants', 0);
  return w;
}

function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.tick();
}

describe('сохранение', () => {
  it('снимок можно пропустить через JSON без потерь', () => {
    const w = busyWorld();
    run(w, 700);
    const s = serializeWorld(w);
    expect(s.version).toBe(SAVE_VERSION);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('загруженный мир совпадает с исходным', () => {
    const w = busyWorld();
    run(w, 900);
    const copy = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(w))))!;
    expect(copy).not.toBeNull();
    expect(serializeWorld(copy)).toEqual(serializeWorld(w));
  });

  it('после загрузки симуляция идёт точно так же (в середине работ, с резервами и ношей)', () => {
    for (const seed of [1, 42, 777]) {
      const a = busyWorld(seed);
      run(a, 650); // поселенцы посреди задач
      expect(a.pawns.some((p) => p.job !== null)).toBe(true);
      const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
      run(a, 1500);
      run(b, 1500);
      expect(serializeWorld(b)).toEqual(serializeWorld(a));
    }
  });

  it('изменённая местность и приказы сохраняются', () => {
    const w = busyWorld();
    run(w, 3000);
    const copy = restoreWorld(serializeWorld(w))!;
    expect(Array.from(copy.map.cells)).toEqual(Array.from(w.map.cells));
    expect([...copy.designations]).toEqual([...w.designations]);
    expect([...copy.zone]).toEqual([...w.zone]);
    expect(copy.tickCount).toBe(w.tickCount);
    expect(copy.pawns[1]!.priorities.mining).toBe(1);
    expect(copy.pawns[2]!.priorities.plants).toBe(0);
  });

  it('копия независима от оригинала', () => {
    const w = busyWorld();
    const s = serializeWorld(w);
    const copy = restoreWorld(s)!;
    copy.pawns[0]!.needs.food = 1;
    expect(w.pawns[0]!.needs.food).toBe(100);
    expect(s.pawns[0]!.needs.food).toBe(100);
  });

  it('повреждённые и чужие данные отклоняются', () => {
    const good = serializeWorld(busyWorld());
    expect(restoreWorld(null)).toBeNull();
    expect(restoreWorld('мусор')).toBeNull();
    expect(restoreWorld({})).toBeNull();
    expect(restoreWorld({ ...good, version: 999 })).toBeNull();
    expect(restoreWorld({ ...good, cells: good.cells.slice(10) })).toBeNull();
    expect(restoreWorld({ ...good, pawns: [{ id: 1 }] })).toBeNull();
  });

  it('старое сохранение без новых работ получает приоритеты по умолчанию', () => {
    const s = serializeWorld(busyWorld());
    delete (s.pawns[0]!.priorities as Partial<Record<string, number>>).research;
    expect(restoreWorld(s)!.pawns[0]!.priorities.research).toBe(3);
  });
});
