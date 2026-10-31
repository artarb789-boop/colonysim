import { describe, expect, it } from 'vitest';
import { DAY_TICKS, MAP_SIZE, NEEDS, STONE_PER_ROCK, WOOD_PER_TREE } from '../src/sim/balance';
import { Terrain } from '../src/sim/map';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

/** Мир с идеально чистой ареной вокруг центра: только трава, без кустов и предметов. */
function arena(opts: { pawnCount?: number; ai?: boolean } = {}): World {
  const w = new World(5, { pawnCount: opts.pawnCount ?? 1, ai: opts.ai ?? true, startItems: false, quiet: true, fixedTemp: 20 });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  return w;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.tick();
}

describe('нужды', () => {
  it('еда и сон падают со временем, отдых восстанавливается без работы', () => {
    const w = arena({ ai: false });
    run(w, DAY_TICKS);
    const n = w.pawns[0]!.needs;
    expect(n.food).toBeCloseTo(100 - NEEDS.foodPerDay, 0);
    expect(n.sleep).toBeCloseTo(100 - NEEDS.sleepPerDay, 0);
    expect(n.rest).toBe(100);
  });

  it('нужды не уходят за 0 и 100', () => {
    const w = arena({ ai: false });
    run(w, DAY_TICKS * 5);
    const n = w.pawns[0]!.needs;
    expect(n.food).toBe(0);
    expect(n.sleep).toBe(0);
    expect(n.rest).toBeLessThanOrEqual(100);
  });
});

describe('срочные нужды', () => {
  it('голодный поселенец идёт есть ягоды и насыщается', () => {
    const w = arena();
    w.items.put(idx(C + 3, C), 'berries', 10);
    const p = w.pawns[0]!;
    p.needs.food = 20;
    run(w, 400);
    expect(p.needs.food).toBeGreaterThan(80);
    expect(w.items.stacks.get(idx(C + 3, C))!.count).toBeLessThan(10);
  });

  it('при пустом складе голодный ест с куста', () => {
    const w = arena();
    w.map.bushes.set(idx(C + 4, C), { berries: 6, regrow: 600 });
    const p = w.pawns[0]!;
    p.needs.food = 10;
    run(w, 400);
    expect(p.needs.food).toBeGreaterThan(50);
    expect(w.map.bushes.get(idx(C + 4, C))!.berries).toBeLessThan(6);
  });

  it('усталый поселенец спит на месте до восстановления', () => {
    const w = arena();
    const p = w.pawns[0]!;
    p.needs.sleep = 10;
    run(w, 5);
    expect(p.job?.kind).toBe('sleep');
    let guard = 0;
    while (p.job !== null && guard++ < 3000) w.tick();
    expect(p.needs.sleep).toBeGreaterThanOrEqual(NEEDS.sleepWake);
    expect(p.job).toBeNull();
    expect([p.cx, p.cy]).toEqual([C, C]); // спал на полу там, где стоял
  });

  it('срочная нужда важнее работы, а работа — после неё', () => {
    const w = arena();
    w.map.set(C + 3, C, Terrain.Tree);
    w.applyOrder('chop', C + 3, C, C + 3, C);
    const p = w.pawns[0]!;
    p.needs.sleep = 10;
    run(w, 5);
    expect(p.job?.kind).toBe('sleep');
    run(w, 3000);
    expect(w.map.get(C + 3, C)).toBe(Terrain.Grass); // потом всё же срубил
  });

  it('критическая нужда прерывает работу, если есть чем её утолить', () => {
    const w = arena();
    for (let i = 0; i < 6; i++) w.map.set(C + 3 + i, C + 1, Terrain.Tree);
    w.applyOrder('chop', C + 3, C + 1, C + 8, C + 1);
    const p = w.pawns[0]!;
    run(w, 30);
    expect(p.job?.kind).toBe('chop');
    p.needs.sleep = NEEDS.sleepCritical - 1;
    run(w, 60);
    expect(p.job?.kind).toBe('sleep');
  });

  it('без еды голод не зацикливает поселенца: он продолжает работать', () => {
    const w = arena();
    w.map.set(C + 3, C, Terrain.Tree);
    w.applyOrder('chop', C + 3, C, C + 3, C);
    const p = w.pawns[0]!;
    p.needs.food = 5;
    run(w, 600);
    expect(w.map.get(C + 3, C)).toBe(Terrain.Grass);
  });
});

describe('работы', () => {
  it('цикл: рубка → брёвна → переноска на склад-зону', () => {
    const w = arena();
    w.map.set(C + 4, C, Terrain.Tree);
    w.applyOrder('chop', C + 4, C, C + 4, C);
    w.applyOrder('zone', C - 5, C + 5, C - 3, C + 5);
    run(w, 1500);
    expect(w.map.get(C + 4, C)).toBe(Terrain.Grass);
    expect(w.designations.size).toBe(0);
    expect(w.stockpile().wood).toBe(WOOD_PER_TREE);
  });

  it('добыча камня оставляет землю и камень, который уносят на склад', () => {
    const w = arena();
    w.map.set(C + 4, C, Terrain.Stone);
    w.applyOrder('mine', C + 4, C, C + 4, C);
    w.applyOrder('zone', C - 5, C + 5, C - 3, C + 5);
    run(w, 2000);
    expect(w.map.get(C + 4, C)).toBe(Terrain.Dirt);
    expect(w.stockpile().stone).toBe(STONE_PER_ROCK);
  });

  it('без склад-зоны предметы лежат там, где упали', () => {
    const w = arena();
    w.map.set(C + 4, C, Terrain.Tree);
    w.applyOrder('chop', C + 4, C, C + 4, C);
    run(w, 1000);
    expect(w.items.total('wood')).toBe(WOOD_PER_TREE);
    expect(w.stockpile().wood).toBe(0);
    expect(w.needsZone).toBe(true);
  });

  it('стопка больше грузоподъёмности переносится за несколько ходок', () => {
    const w = arena();
    w.items.put(idx(C + 5, C), 'stone', 50);
    w.applyOrder('zone', C - 5, C + 5, C - 5, C + 7);
    run(w, 3000);
    expect(w.stockpile().stone).toBe(50);
  });

  it('склад принимает разные виды в разные клетки', () => {
    const w = arena();
    w.items.put(idx(C + 5, C), 'stone', 10);
    w.items.put(idx(C + 5, C + 1), 'wood', 10);
    w.applyOrder('zone', C - 5, C + 5, C - 4, C + 5);
    run(w, 3000);
    const s = w.stockpile();
    expect(s.stone).toBe(10);
    expect(s.wood).toBe(10);
  });

  it('ягоды собираются на склад, пока запас ниже цели', () => {
    const w = arena();
    w.map.bushes.set(idx(C + 4, C), { berries: 6, regrow: 600 });
    w.applyOrder('zone', C - 5, C + 5, C - 3, C + 5);
    run(w, 1500);
    expect(w.stockpile().berries).toBe(6);
  });
});

describe('приоритеты', () => {
  function twoJobs(): World {
    const w = arena();
    // дерево близко (3 клетки), камень дальше (8 клеток) — обе работы с приоритетом 3
    w.map.set(C + 3, C, Terrain.Tree);
    w.map.set(C - 8, C, Terrain.Stone);
    w.applyOrder('chop', C + 3, C, C + 3, C);
    w.applyOrder('mine', C - 8, C, C - 8, C);
    return w;
  }

  it('при равных приоритетах берётся ближайшая работа', () => {
    const w = twoJobs();
    run(w, 3);
    expect(w.pawns[0]!.job?.kind).toBe('chop');
  });

  it('приоритет 1 раньше 4, даже если дальше', () => {
    const w = twoJobs();
    w.setPriority(0, 'plants', 4);
    w.setPriority(0, 'mining', 1);
    run(w, 3);
    expect(w.pawns[0]!.job?.kind).toBe('mine');
  });

  it('выключенная работа не выполняется', () => {
    const w = twoJobs();
    w.setPriority(0, 'plants', 0);
    run(w, 3000);
    expect(w.map.get(C + 3, C)).toBe(Terrain.Tree);
    expect(w.map.get(C - 8, C)).toBe(Terrain.Dirt);
  });

  it('два поселенца не берут одну и ту же цель', () => {
    const w = arena({ pawnCount: 2 });
    w.map.set(C + 4, C, Terrain.Tree);
    w.applyOrder('chop', C + 4, C, C + 4, C);
    run(w, 5);
    const jobs = w.pawns.filter((p) => p.job?.kind === 'chop');
    expect(jobs).toHaveLength(1);
  });

  it('отмена приказа посреди работы освобождает поселенца', () => {
    const w = arena();
    w.map.set(C + 4, C, Terrain.Tree);
    w.applyOrder('chop', C + 4, C, C + 4, C);
    run(w, 40);
    expect(w.pawns[0]!.job?.kind).toBe('chop');
    w.applyOrder('erase', C + 4, C, C + 4, C);
    run(w, 5);
    expect(w.pawns[0]!.job).toBeNull();
    expect(w.map.get(C + 4, C)).toBe(Terrain.Tree);
  });
});

describe('приказы', () => {
  it('рубить можно только деревья, добывать — только камень', () => {
    const w = arena();
    w.map.set(C + 1, C, Terrain.Tree);
    w.map.set(C + 2, C, Terrain.Stone);
    expect(w.applyOrder('chop', C, C, C + 3, C)).toBe(1);
    expect(w.applyOrder('mine', C, C, C + 3, C)).toBe(1);
    expect(w.applyOrder('chop', C, C, C + 3, C)).toBe(0); // повторно не считается
  });

  it('склад — только на проходимых клетках; стирание снимает и склад, и приказы', () => {
    const w = arena();
    w.map.set(C + 2, C, Terrain.Water);
    expect(w.applyOrder('zone', C, C, C + 3, C)).toBe(3);
    expect(w.zone.has(idx(C + 2, C))).toBe(false);
    expect(w.applyOrder('erase', C, C, C + 3, C)).toBe(3);
    expect(w.zone.size).toBe(0);
  });

  it('прямоугольник можно задавать в любом направлении и обрезается по карте', () => {
    const w = arena();
    for (let y = 0; y <= 1; y++) for (let x = 0; x <= 2; x++) w.map.set(x, y, Terrain.Grass);
    expect(w.applyOrder('zone', 2, 1, 0, 0)).toBe(6);
    expect(w.applyOrder('zone', -5, -5, -1, -1)).toBe(0);
  });
});

describe('кусты и предметы', () => {
  it('куст отрастает', () => {
    const w = arena({ ai: false });
    w.map.bushes.set(idx(C + 4, C), { berries: 0, regrow: 10 });
    run(w, 10);
    expect(w.map.bushes.get(idx(C + 4, C))!.berries).toBe(1);
  });

  it('предметы не помещаются в клетку с другим видом — уходят в соседнюю', () => {
    const w = arena({ ai: false });
    w.items.put(idx(C, C), 'wood', 10);
    const left = w.items.drop('stone', 5, C, C);
    expect(left).toBe(0);
    expect(w.items.stacks.get(idx(C, C))!.kind).toBe('wood');
    expect(w.items.total('stone')).toBe(5);
  });
});
