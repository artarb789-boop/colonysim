import { describe, expect, it } from 'vitest';
import { CROP, CROP_STOCK_TARGET, DAY_TICKS, HERB, MAP_SIZE } from '../src/sim/balance';
import { Terrain } from '../src/sim/map';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function farm(pawns = 3): World {
  const w = new World(5, { pawnCount: pawns, startItems: false, quiet: true, fixedTemp: 20, stroll: false });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  w.applyOrder('zone', C - 10, C + 6, C - 3, C + 9);
  return w;
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) {
    for (const p of w.pawns) p.needs.sleep = Math.max(p.needs.sleep, 60); // не спят, только едят по нужде
    w.tick();
  }
};

describe('склад не забивается урожаем', () => {
  it('8 клеток огорода за 26 суток не дают сотни риса', () => {
    const w = farm();
    w.applyOrder('garden', C + 2, C - 2, C + 5, C - 1); // 8 клеток
    expect(w.garden.size).toBe(8);
    let peak = 0;
    for (let d = 0; d < 26; d++) {
      run(w, DAY_TICKS);
      peak = Math.max(peak, w.items.total('rice'));
    }
    // запас ограничен целью плюс то, что созревает на грядках
    expect(peak).toBeLessThanOrEqual(CROP_STOCK_TARGET.rice + 8 * CROP.yield);
    expect(w.items.total('rice')).toBeLessThan(120);
  });

  it('при полном запасе новые посевы не начинают, после расхода — начинают снова', () => {
    const w = farm(1);
    w.pawns[0]!.needs.food = 100;
    w.applyOrder('garden', C + 2, C, C + 3, C);
    w.items.put(idx(C - 5, C + 7), 'rice', 50);
    w.items.put(idx(C - 6, C + 7), 'rice', 50);
    run(w, 600);
    expect(w.map.crops.size).toBe(0); // 100 риса уже есть — сеять не надо
    w.items.take(idx(C - 5, C + 7), 50);
    w.items.take(idx(C - 6, C + 7), 50);
    run(w, 600);
    expect(w.map.crops.size).toBe(2); // запас иссяк — посеяли снова
  });

  it('потенциал считает лежащее, несомое и растущее', () => {
    const w = farm(1);
    expect(w.cropPotential('rice')).toBe(0);
    w.items.put(idx(C - 5, C + 7), 'rice', 10);
    w.map.crops.set(idx(C + 2, C), { growth: 10 });
    w.map.crops.set(idx(C + 3, C), { growth: 10, kind: 'herb' });
    expect(w.cropPotential('rice')).toBe(10 + CROP.yield);
    expect(w.cropPotential('herb')).toBe(HERB.yield);
    w.pawns[0]!.carrying = { kind: 'rice', count: 3 };
    expect(w.cropPotential('rice')).toBe(13 + CROP.yield);
  });

  it('травы тоже не копятся без меры', () => {
    const w = farm();
    w.applyOrder('herbs', C + 2, C - 2, C + 5, C - 1);
    for (let d = 0; d < 20; d++) run(w, DAY_TICKS);
    expect(w.items.total('herb')).toBeLessThanOrEqual(CROP_STOCK_TARGET.herb + 8 * HERB.yield);
  });

  it('урожай меньше прежнего', () => {
    expect(CROP.yield).toBeLessThan(6);
    expect(HERB.yield).toBeLessThan(3);
  });
});
