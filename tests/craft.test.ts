import { describe, expect, it } from 'vitest';
import { BUILD, CRAFT, CROP, DAY_TICKS, HEALTH, HERB, MAP_SIZE, RECIPES } from '../src/sim/balance';
import { addWound } from '../src/sim/health';
import { Structure, Terrain } from '../src/sim/map';
import { restoreWorld, serializeWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function arena(pawns = 2, temp = 20): World {
  const w = new World(5, { pawnCount: pawns, startItems: false, quiet: true, fixedTemp: temp, stroll: false });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  return w;
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) {
    for (const p of w.pawns) if (!p.dead) p.needs = { food: 100, sleep: 100, rest: 100 };
    w.tick();
  }
};
/** Мир, где уже пора готовить оружие (день ≥ 10) и стоит верстак. */
function shop(pawns = 2): World {
  const w = arena(pawns);
  w.tickCount = DAY_TICKS * 11;
  w.map.structure[idx(C + 3, C)] = Structure.Bench;
  return w;
}

describe('верстак', () => {
  it('строится из дерева, непроходим, при разборке возвращает половину', () => {
    const w = arena(1);
    w.items.put(idx(C - 4, C), 'wood', 30);
    expect(w.placeBlueprints('bench', [{ x: C + 3, y: C }])).toBe(1);
    run(w, 2500);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.Bench);
    expect(w.map.isPassable(C + 3, C)).toBe(false);
    expect(w.items.total('wood')).toBe(30 - BUILD.bench.count);
    w.applyOrder('deconstruct', C + 3, C, C + 3, C);
    run(w, 1200);
    expect(w.map.structure[idx(C + 3, C)]).toBe(Structure.None);
    expect(w.items.total('wood')).toBe(30 - BUILD.bench.count + Math.floor(BUILD.bench.count / 2));
  });
});

describe('ремесло', () => {
  it('из дерева делают дубины, пока их не хватает на всех', () => {
    const w = shop(3);
    w.items.put(idx(C - 4, C), 'wood', 50);
    w.items.put(idx(C - 4, C + 1), 'wood', 50);
    run(w, 3000);
    expect(w.items.total('club')).toBe(3); // цель: не меньше трёх, на каждого
    expect(w.items.total('bow')).toBe(2); // а затем луки для половины колонии
    expect(w.items.total('wood')).toBe(100 - 3 * RECIPES.club.count - 2 * RECIPES.bow.count);
  });

  it('учитываются дубины в руках: лишнего не делают', () => {
    const w = shop(3);
    for (const p of w.pawns) p.weapon = 'club';
    w.items.put(idx(C - 4, C), 'wood', 50);
    run(w, 1500);
    expect(w.items.total('club')).toBe(0);
  });

  it('когда дубин хватает, делают луки для половины колонии', () => {
    const w = shop(3);
    for (const p of w.pawns) p.weapon = 'club';
    w.items.put(idx(C - 4, C), 'wood', 50);
    run(w, 3000);
    expect(w.items.total('bow')).toBe(2); // ceil(3 / 2)
    expect(w.items.total('wood')).toBe(50 - 2 * RECIPES.bow.count);
  });

  it('до 10-х суток оружие не делают, если не было набегов', () => {
    const w = arena(2);
    w.map.structure[idx(C + 3, C)] = Structure.Bench;
    w.items.put(idx(C - 4, C), 'wood', 50);
    run(w, 1500);
    expect(w.items.total('club')).toBe(0);
    w.story.raidsDone = 1;
    run(w, 2500);
    expect(w.items.total('club')).toBeGreaterThan(0);
  });

  it('аптечки делают из трав и не больше цели', () => {
    const w = arena(2);
    w.map.structure[idx(C + 3, C)] = Structure.Bench;
    w.items.put(idx(C - 4, C), 'herb', 50);
    w.items.put(idx(C - 4, C + 1), 'herb', 50);
    run(w, 3500);
    expect(w.items.total('medkit')).toBe(CRAFT.medkitTarget);
    expect(w.items.total('herb')).toBe(100 - CRAFT.medkitTarget * RECIPES.medkit.count);
  });

  it('без верстака, без материала или без работы «Ремесло» ничего не делают', () => {
    const noBench = arena(2);
    noBench.tickCount = DAY_TICKS * 11;
    noBench.items.put(idx(C - 4, C), 'wood', 50);
    run(noBench, 1000);
    expect(noBench.items.total('club')).toBe(0);

    const off = shop(2);
    for (const p of off.pawns) off.setPriority(p.id, 'crafting', 0);
    off.items.put(idx(C - 4, C), 'wood', 50);
    run(off, 1500);
    expect(off.items.total('club')).toBe(0);

    const noWood = shop(2);
    noWood.items.put(idx(C - 4, C), 'wood', RECIPES.club.count - 1);
    run(noWood, 800);
    expect(noWood.items.total('club')).toBe(0);
  });

  it('изделия уносят на склад-зону', () => {
    const w = shop(2);
    w.applyOrder('zone', C - 6, C + 5, C - 4, C + 5);
    w.items.put(idx(C - 4, C), 'wood', 20);
    run(w, 3000);
    expect(w.stockpile().club).toBeGreaterThan(0);
  });

  it('мастер с высоким навыком работает быстрее', () => {
    const time = (skill: number) => {
      const w = shop(1);
      w.pawns[0]!.skills.crafting = skill;
      w.items.put(idx(C - 2, C), 'wood', 30);
      let n = 0;
      while (w.items.total('club') === 0 && n++ < 4000) {
        w.pawns[0]!.needs = { food: 100, sleep: 100, rest: 100 };
        w.tick();
      }
      return n;
    };
    expect(time(15)).toBeLessThan(time(0));
  });

  it('опытный стрелок берёт лук, остальные — дубину; если нужного нет, любое', () => {
    const w = arena(2);
    w.items.put(idx(C + 2, C), 'club', 1);
    w.items.put(idx(C - 2, C), 'bow', 1);
    w.pawns[0]!.skills.shooting = 12;
    w.pawns[1]!.skills.shooting = 1;
    w.setAlarm(true);
    run(w, 300);
    expect(w.pawns[0]!.weapon).toBe('bow');
    expect(w.pawns[1]!.weapon).toBe('club');

    const v = arena(1);
    v.items.put(idx(C + 2, C), 'club', 1);
    v.pawns[0]!.skills.shooting = 14;
    v.setAlarm(true);
    run(v, 300);
    expect(v.pawns[0]!.weapon).toBe('club'); // лука нет — берёт дубину
  });
});

describe('целебные травы', () => {
  it('грядка трав отдельна от огорода и склада', () => {
    const w = arena(1);
    expect(w.applyOrder('herbs', C + 2, C, C + 4, C)).toBe(3);
    expect(w.herbs.size).toBe(3);
    expect(w.applyOrder('garden', C + 3, C, C + 3, C)).toBe(1);
    expect(w.herbs.has(idx(C + 3, C))).toBe(false);
    expect(w.garden.has(idx(C + 3, C))).toBe(true);
    expect(w.applyOrder('zone', C + 2, C, C + 2, C)).toBe(1);
    expect(w.herbs.has(idx(C + 2, C))).toBe(false);
    expect(w.applyOrder('erase', C + 4, C, C + 4, C)).toBe(1);
    expect(w.herbs.size).toBe(0);
  });

  it('травы сеют, они зреют быстрее риса и дают траву', () => {
    const w = arena(1);
    w.applyOrder('herbs', C + 3, C, C + 3, C);
    w.applyOrder('garden', C + 3, C + 2, C + 3, C + 2);
    run(w, 300);
    const herb = w.map.crops.get(idx(C + 3, C))!;
    const rice = w.map.crops.get(idx(C + 3, C + 2))!;
    expect(herb.kind).toBe('herb');
    expect(rice.kind).toBeUndefined();
    expect(HERB.growTicks).toBeLessThan(CROP.growTicks);
    w.applyOrder('zone', C - 6, C + 5, C - 4, C + 5);
    run(w, HERB.growTicks + 1200);
    expect(w.stockpile().herb).toBeGreaterThanOrEqual(HERB.yield);
    // рис к этому времени ещё не созрел и не собран
    expect(w.items.total('rice')).toBe(0);
  });

  it('заморозки губят молодые травы', () => {
    const w = arena(1, -6);
    w.setPriority(0, 'plants', 0); // чтобы зрелую траву не собрали раньше
    w.map.crops.set(idx(C + 3, C), { growth: 100, kind: 'herb' });
    w.map.crops.set(idx(C + 4, C), { growth: HERB.growTicks, kind: 'herb' });
    run(w, 200);
    expect(w.map.crops.has(idx(C + 3, C))).toBe(false);
    expect(w.map.crops.has(idx(C + 4, C))).toBe(true);
  });
});

describe('аптечки в лечении', () => {
  it('перевязка с аптечкой быстрее, качественнее и тратит аптечку', () => {
    const treat = (kit: boolean) => {
      const w = arena(2);
      w.pawns[1]!.skills.medicine = 5;
      w.setPriority(0, 'doctor', 0);
      if (kit) w.items.put(idx(C - 4, C), 'medkit', 2);
      addWound(w.pawns[0]!, 'legL', 'cut', 10);
      let n = 0;
      while (w.pawns[0]!.wounds.some((x) => !x.treated) && n++ < 2000) {
        for (const p of w.pawns) p.needs = { food: 100, sleep: 100, rest: 100 };
        w.tick();
      }
      return { n, quality: w.pawns[0]!.wounds[0]!.quality, kits: w.items.total('medkit'), log: w.log.map((l) => l.text) };
    };
    const plain = treat(false);
    const kit = treat(true);
    expect(kit.n).toBeLessThan(plain.n);
    expect(kit.quality).toBeCloseTo(plain.quality * CRAFT.medkitQuality, 9);
    expect(kit.kits).toBe(1);
    expect(kit.log.some((l) => l.startsWith('Использована аптечка'))).toBe(true);
    expect(plain.log.some((l) => l.startsWith('Использована аптечка'))).toBe(false);
  });

  it('раны с аптечкой заживают заметно быстрее', () => {
    const rest = (kit: boolean) => {
      const w = arena(2);
      if (kit) w.items.put(idx(C - 4, C), 'medkit', 1);
      addWound(w.pawns[0]!, 'legL', 'cut', 10);
      run(w, 3000);
      return w.pawns[0]!.wounds.reduce((a, x) => a + x.damage, 0);
    };
    expect(rest(true)).toBeLessThan(rest(false));
    expect(HEALTH.treatTicks).toBeGreaterThan(0);
  });
});

describe('сохранение 5c', () => {
  it('грядка трав, посев с видом культуры и верстак переживают сохранение', () => {
    const a = shop(2);
    a.applyOrder('herbs', C - 6, C - 6, C - 4, C - 4);
    a.items.put(idx(C - 4, C), 'wood', 40);
    run(a, 600);
    const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
    expect(b.herbs.size).toBe(a.herbs.size);
    expect([...b.map.crops].map(([k, c]) => [k, c.kind])).toEqual([...a.map.crops].map(([k, c]) => [k, c.kind]));
    run(a, 1500);
    run(b, 1500);
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
  });

  it('сохранение версии 5 (без трав) загружается', () => {
    const w = new World(6);
    run(w, 200);
    const s = serializeWorld(w) as unknown as Record<string, unknown>;
    s.version = 5;
    delete s.herbs;
    const back = restoreWorld(JSON.parse(JSON.stringify(s)))!;
    expect(back).not.toBeNull();
    expect(back.herbs.size).toBe(0);
    run(back, 200);
  });
});
