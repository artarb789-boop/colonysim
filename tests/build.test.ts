import { describe, expect, it } from 'vitest';
import { BUILD, CROP, MAP_SIZE } from '../src/sim/balance';
import { cellsOf, shapeOf } from '../src/sim/build';
import { Structure, Terrain } from '../src/sim/map';
import { findPath } from '../src/sim/pathfinding';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

/** Чистая арена: трава, без кустов и предметов. */
function arena(pawnCount = 1): World {
  const w = new World(5, { pawnCount, startItems: false });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  return w;
}
function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.tick();
}

describe('cellsOf', () => {
  it('линия прилипает к оси с большим смещением', () => {
    expect(cellsOf('line', 2, 2, 5, 3).map((c) => [c.x, c.y])).toEqual([[2, 2], [3, 2], [4, 2], [5, 2]]);
    expect(cellsOf('line', 2, 2, 3, -1).map((c) => [c.x, c.y])).toEqual([[2, 2], [2, 1], [2, 0], [2, -1]]);
    expect(cellsOf('line', 4, 4, 4, 4)).toHaveLength(1);
  });
  it('линия идёт и влево', () => {
    expect(cellsOf('line', 5, 0, 3, 0).map((c) => c.x)).toEqual([5, 4, 3]);
  });
  it('прямоугольник включает границы в любом порядке углов', () => {
    expect(cellsOf('rect', 3, 3, 1, 2)).toHaveLength(6);
  });
  it('стены — линией, остальное — прямоугольником', () => {
    expect(shapeOf('wall')).toBe('line');
    expect(shapeOf('floor')).toBe('rect');
    expect(shapeOf('bed')).toBe('rect');
  });
});

describe('чертежи', () => {
  it('ставятся только на пустую землю или траву', () => {
    const w = arena();
    w.map.set(C + 1, C, Terrain.Water);
    w.map.set(C + 2, C, Terrain.Tree);
    w.map.bushes.set(idx(C + 3, C), { berries: 3, regrow: 10 });
    w.items.put(idx(C + 4, C), 'wood', 5);
    expect(w.placeBlueprints('wall', [{ x: C + 1, y: C }, { x: C + 2, y: C }, { x: C + 3, y: C }, { x: C + 4, y: C }])).toBe(0);
    expect(w.placeBlueprints('wall', [{ x: C + 5, y: C }, { x: C + 5, y: C }])).toBe(1); // дубль не считается
    expect(w.placeBlueprints('wall', [{ x: -1, y: 0 }])).toBe(0);
  });

  it('отмена возвращает подвезённый материал', () => {
    const w = arena();
    w.placeBlueprints('wall', [{ x: C + 3, y: C }]);
    w.blueprints.get(idx(C + 3, C))!.delivered = 2;
    w.applyOrder('erase', C + 3, C, C + 3, C);
    expect(w.blueprints.size).toBe(0);
    expect(w.items.total('stone')).toBe(2);
  });
});

describe('строительство', () => {
  it('стена: подвоз камня → постройка → клетка непроходима, камень потрачен', () => {
    const w = arena();
    w.items.put(idx(C - 4, C), 'stone', 10);
    w.placeBlueprints('wall', [{ x: C + 3, y: C }]);
    run(w, 1500);
    expect(w.blueprints.size).toBe(0);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.Wall);
    expect(w.map.isPassable(C + 3, C)).toBe(false);
    expect(w.items.total('stone')).toBe(10 - BUILD.wall.count);
  });

  it('без материалов ничего не строится', () => {
    const w = arena();
    w.placeBlueprints('wall', [{ x: C + 3, y: C }]);
    run(w, 600);
    expect(w.blueprints.size).toBe(1);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.None);
  });

  it('линия стен и дверь: проход остаётся через дверь', () => {
    const w = arena();
    w.items.put(idx(C - 4, C - 4), 'stone', 50);
    w.items.put(idx(C - 4, C - 5), 'stone', 50);
    w.items.put(idx(C - 5, C - 4), 'wood', 50);
    w.placeBlueprints('wall', cellsOf('line', C + 4, C - 3, C + 4, C - 1));
    w.placeBlueprints('door', [{ x: C + 4, y: C }]);
    w.placeBlueprints('wall', cellsOf('line', C + 4, C + 1, C + 4, C + 3));
    run(w, 6000);
    expect(w.blueprints.size).toBe(0);
    expect(w.map.structure[idx(C + 4, C)]).toBe(Structure.Door);
    expect(w.map.isPassable(C + 4, C)).toBe(true);
    expect(w.map.isPassable(C + 4, C - 1)).toBe(false);
  });

  it('пол: проходим и быстрее травы', () => {
    const w = arena();
    const grass = w.map.moveCost(C + 3, C);
    w.items.put(idx(C - 4, C), 'wood', 10);
    w.placeBlueprints('floor', [{ x: C + 3, y: C }]);
    run(w, 1500);
    expect(w.map.floor[idx(C + 3, C)]).toBe(1);
    expect(w.map.isPassable(C + 3, C)).toBe(true);
    expect(w.map.moveCost(C + 3, C)).toBeLessThan(grass);
  });

  it('кровать и плита ставятся; плита перекрывает проход, кровать — нет', () => {
    const w = arena();
    w.items.put(idx(C - 4, C), 'wood', 30);
    w.items.put(idx(C - 4, C + 1), 'stone', 30);
    w.placeBlueprints('bed', [{ x: C + 3, y: C }]);
    w.placeBlueprints('stove', [{ x: C + 3, y: C + 2 }]);
    run(w, 6000);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.Bed);
    expect(w.map.isPassable(C + 3, C)).toBe(true);
    expect(w.map.structure[idx(C + 3, C + 2)]).toBe(Structure.Stove);
    expect(w.map.isPassable(C + 3, C + 2)).toBe(false);
  });

  it('несколько строителей работают параллельно и не мешают друг другу', () => {
    const w = arena(3);
    w.items.put(idx(C - 4, C - 4), 'stone', 50);
    w.items.put(idx(C - 4, C - 5), 'stone', 50);
    w.placeBlueprints('wall', cellsOf('line', C + 3, C - 4, C + 3, C + 4));
    run(w, 6000);
    expect(w.blueprints.size).toBe(0);
    for (let y = C - 4; y <= C + 4; y++) expect(w.map.structure[idx(C + 3, y)]).toBe(Structure.Wall);
  });

  it('стена на клетке, где стоит праздный поселенец, не запирает его: он отходит', () => {
    const w = arena();
    w.items.put(idx(C - 4, C), 'stone', 10);
    const p = w.pawns[0]!;
    w.placeBlueprints('wall', [{ x: p.cx, y: p.cy }]);
    run(w, 1500);
    expect(w.map.structure[idx(C, C)]).toBe(Structure.Wall);
    expect(w.map.isPassable(p.cx, p.cy)).toBe(true);
    expect([p.cx, p.cy]).not.toEqual([C, C]);
  });

  it('новая стена на пути не пускает поселенца сквозь себя', () => {
    const w = arena(2);
    w.items.put(idx(C - 4, C + 6), 'stone', 10);
    w.pawns[1]!.priorities.construction = 1;
    w.moveTo(0, C + 8, C);
    run(w, 3);
    w.map.structure[idx(C + 4, C)] = Structure.Wall; // стена мгновенно появилась на пути
    run(w, 400);
    const p = w.pawns[0]!;
    expect(w.map.isPassable(p.cx, p.cy)).toBe(true);
    expect(p.cx).toBeLessThan(C + 4); // не прошёл через стену
  });

  it('разборка возвращает половину материалов и освобождает клетку', () => {
    const w = arena();
    w.map.structure[idx(C + 3, C)] = Structure.Wall;
    expect(w.applyOrder('deconstruct', C + 3, C, C + 3, C)).toBe(1);
    run(w, 800);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.None);
    expect(w.map.isPassable(C + 3, C)).toBe(true);
    expect(w.items.total('stone')).toBe(Math.floor(BUILD.wall.count * 0.5));
    expect(w.designations.size).toBe(0);
  });

  it('постройки обходятся поиском пути', () => {
    const w = arena();
    for (let y = C - 3; y <= C + 3; y++) w.map.structure[idx(C + 2, y)] = Structure.Wall;
    const p = findPath(w.map, C, C, C + 4, C)!;
    expect(p.length).toBeGreaterThan(4);
    expect(p.every((c) => w.map.isPassable(c.x, c.y))).toBe(true);
  });

  it('постройка на зоне убирает клетку из зоны, предметы переезжают', () => {
    const w = arena();
    w.applyOrder('zone', C + 3, C, C + 3, C);
    expect(w.zone.has(idx(C + 3, C))).toBe(true);
    w.items.put(idx(C - 4, C), 'stone', 10);
    // предметы на клетке чертежа ставить нельзя, а положить можно, когда чертёж уже есть
    w.placeBlueprints('wall', [{ x: C + 3, y: C }]);
    w.items.put(idx(C + 3, C), 'wood', 4);
    run(w, 1500);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.Wall);
    expect(w.zone.has(idx(C + 3, C))).toBe(false);
    expect(w.items.stacks.has(idx(C + 3, C))).toBe(false);
    expect(w.items.total('wood')).toBe(4);
  });
});

describe('огород', () => {
  it('огород — только на проходимой земле, не пересекается со складом', () => {
    const w = arena();
    w.map.set(C + 2, C, Terrain.Water);
    expect(w.applyOrder('garden', C, C, C + 3, C)).toBe(3);
    expect(w.applyOrder('zone', C, C, C, C)).toBe(1); // клетка переходит в склад
    expect(w.garden.has(idx(C, C))).toBe(false);
    expect(w.zone.has(idx(C, C))).toBe(true);
  });

  it('цикл: посев → рост → сбор → рис на склад', () => {
    const w = arena();
    w.applyOrder('garden', C + 3, C, C + 3, C);
    w.applyOrder('zone', C - 5, C + 5, C - 4, C + 5);
    run(w, 200);
    expect(w.map.crops.has(idx(C + 3, C))).toBe(true);
    // поселенец сыт всё время, иначе он съест собранный рис
    for (let i = 0; i < CROP.growTicks + 800; i++) {
      w.pawns[0]!.needs.food = 100;
      w.tick();
    }
    expect(w.stockpile().rice).toBeGreaterThanOrEqual(CROP.yield);
  });

  it('несозревший урожай не собирают', () => {
    const w = arena();
    w.applyOrder('garden', C + 3, C, C + 3, C);
    run(w, 600);
    expect(w.map.crops.get(idx(C + 3, C))).toBeDefined();
    expect(w.items.total('rice')).toBe(0);
  });

  it('голодный ест рис', () => {
    const w = arena();
    w.items.put(idx(C + 3, C), 'rice', 10);
    const p = w.pawns[0]!;
    p.needs.food = 15;
    run(w, 400);
    expect(p.needs.food).toBeGreaterThan(70);
    expect(w.items.total('rice')).toBeLessThan(10);
  });
});

describe('сохранение стройки', () => {
  it('постройки, чертежи и посевы переживают сохранение', async () => {
    const { serializeWorld, restoreWorld } = await import('../src/sim/serialize');
    const w = arena(2);
    w.items.put(idx(C - 4, C), 'stone', 30);
    w.items.put(idx(C - 4, C + 1), 'wood', 30);
    w.placeBlueprints('wall', cellsOf('line', C + 3, C - 2, C + 3, C + 2));
    w.placeBlueprints('floor', cellsOf('rect', C + 5, C - 1, C + 6, C + 1));
    w.applyOrder('garden', C - 8, C - 8, C - 6, C - 6);
    run(w, 900);
    const a = restoreWorld(serializeWorld(w))!;
    run(w, 3000);
    run(a, 3000);
    expect(serializeWorld(a)).toEqual(serializeWorld(w));
    expect(Array.from(a.map.structure)).toEqual(Array.from(w.map.structure));
  });

  it('сохранение старого формата (v1) загружается', async () => {
    const { serializeWorld, restoreWorld } = await import('../src/sim/serialize');
    const w = arena(2);
    w.applyOrder('chop', C - 6, C - 6, C + 6, C + 6);
    run(w, 300);
    const v2 = serializeWorld(w) as unknown as Record<string, unknown>;
    // собираем «старый» файл: без новых полей, ключи резервов с множителем 4
    const old = { ...v2, version: 1 } as Record<string, unknown>;
    for (const k of ['structure', 'floor', 'crops', 'garden', 'blueprints']) delete old[k];
    old.reservations = (v2.reservations as [number, number][]).map(([k, owner]) => [Math.floor(k / 8) * 4 + (k % 8), owner]);
    const back = restoreWorld(old)!;
    expect(back).not.toBeNull();
    expect(back.exportReservations()).toEqual(w.exportReservations());
    expect(back.map.structure.every((v) => v === 0)).toBe(true);
    run(back, 500);
  });
});
