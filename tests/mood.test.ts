import { describe, expect, it } from 'vitest';
import { COOK, DAY_TICKS, MAP_SIZE, MOOD, NEEDS, STATE_MOODS, THOUGHTS } from '../src/sim/balance';
import { addThought, computeMood, moodEntries } from '../src/sim/mood';
import { Structure, Terrain } from '../src/sim/map';
import { computeRooms } from '../src/sim/rooms';
import { restoreWorld, serializeWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function arena(pawnCount = 1): World {
  const w = new World(5, { pawnCount, startItems: false });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  return w;
}
function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.tick();
}
/** Прямоугольная комната со стенами по периметру; door — клетка двери (или null). */
function room(w: World, x0: number, y0: number, x1: number, y1: number, door: [number, number] | null = null): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) w.map.structure[idx(x, y)] = Structure.Wall;
    }
  if (door) w.map.structure[idx(door[0], door[1])] = Structure.Door;
  w.invalidateRooms();
}

/** Комната, в которую входит клетка (естественные ниши среди скал тоже считаются комнатами, поэтому ищем по клетке). */
function roomAt(w: World, x: number, y: number) {
  const id = w.rooms().roomOf[idx(x, y)]!;
  return id >= 0 ? w.rooms().rooms[id] : undefined;
}

describe('комнаты', () => {
  it('замкнутая область — комната, открытая — улица', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2, [C + 3, C]);
    const rm = w.rooms();
    expect(roomAt(w, C + 5, C)!.cells).toHaveLength(4 * 3); // 4×3 внутри
    expect(rm.roomOf[idx(C, C)]).toBe(-1); // улица
    expect(rm.roomOf[idx(C + 3, C)]).toBe(-1); // дверь — не часть комнаты
  });

  it('дыра в стене превращает комнату в улицу', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2);
    expect(roomAt(w, C + 5, C)).toBeDefined();
    w.map.structure[idx(C + 3, C)] = Structure.None;
    w.invalidateRooms();
    expect(roomAt(w, C + 5, C)).toBeUndefined();
  });

  it('кровати и плиты считаются внутри комнаты', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2);
    w.map.structure[idx(C + 5, C)] = Structure.Bed;
    w.map.structure[idx(C + 6, C)] = Structure.Stove;
    w.invalidateRooms();
    const r = roomAt(w, C + 5, C)!;
    expect(r.beds).toEqual([idx(C + 5, C)]);
    expect(r.stoves).toEqual([idx(C + 6, C)]);
  });

  it('слишком большая область — не комната', () => {
    const w = arena();
    const rm = computeRooms(w.map);
    expect(rm.roomOf[idx(C, C)]).toBe(-1);
    expect(rm.rooms.every((r) => r.cells.length < 10)).toBe(true);
  });

  it('достройка стены обновляет комнаты', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2);
    w.map.structure[idx(C + 3, C)] = Structure.None;
    w.invalidateRooms();
    expect(roomAt(w, C + 5, C)).toBeUndefined();
    w.placeBlueprints('wall', [{ x: C + 3, y: C }]);
    w.items.put(idx(C - 4, C), 'stone', 10);
    run(w, 2500);
    expect(roomAt(w, C + 5, C)).toBeDefined();
  });
});

describe('сон и кровати', () => {
  it('усталый идёт в свободную кровать и закрепляет её', () => {
    const w = arena();
    w.map.structure[idx(C + 4, C)] = Structure.Bed;
    const p = w.pawns[0]!;
    p.needs.sleep = 10;
    run(w, 200);
    expect(p.ownedBed).toBe(idx(C + 4, C));
    expect([p.cx, p.cy]).toEqual([C + 4, C]);
    expect(p.job?.kind).toBe('sleep');
  });

  it('два поселенца берут разные кровати', () => {
    const w = arena(2);
    w.map.structure[idx(C + 4, C)] = Structure.Bed;
    w.map.structure[idx(C + 4, C + 2)] = Structure.Bed;
    for (const p of w.pawns) p.needs.sleep = 10;
    run(w, 300);
    const [a, b] = w.pawns;
    expect(a!.ownedBed).not.toBeNull();
    expect(b!.ownedBed).not.toBeNull();
    expect(a!.ownedBed).not.toBe(b!.ownedBed);
  });

  it('на полу: мысль «спал на полу», в кровати: «спал в кровати»', () => {
    const floor = arena();
    floor.pawns[0]!.needs.sleep = 10;
    let g = 0;
    while (floor.pawns[0]!.needs.sleep < NEEDS.sleepWake && g++ < 3000) floor.tick();
    run(floor, 2);
    expect(floor.pawns[0]!.thoughts.map((t) => t.id)).toContain('sleptOnFloor');

    const bed = arena();
    bed.map.structure[idx(C + 4, C)] = Structure.Bed;
    bed.pawns[0]!.needs.sleep = 10;
    g = 0;
    while (bed.pawns[0]!.job === null && g++ < 50) bed.tick();
    g = 0;
    while (bed.pawns[0]!.job !== null && g++ < 3000) bed.tick();
    const ids = bed.pawns[0]!.thoughts.map((t) => t.id);
    expect(ids).toContain('sleptInBed');
    expect(ids).not.toContain('sleptOnFloor');
    expect(ids).not.toContain('ownBedroom'); // кровать под открытым небом
  });

  it('своя спальня: кровать одна в замкнутой комнате', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2, [C + 3, C]);
    w.map.structure[idx(C + 6, C)] = Structure.Bed;
    w.invalidateRooms();
    w.pawns[0]!.needs.sleep = 10;
    let g = 0;
    while (w.pawns[0]!.job === null && g++ < 50) w.tick();
    g = 0;
    while (w.pawns[0]!.job !== null && g++ < 3000) w.tick();
    expect(w.pawns[0]!.thoughts.map((t) => t.id)).toContain('ownBedroom');
  });

  it('две кровати в одной комнате — «своей спальни» нет', () => {
    const w = arena();
    room(w, C + 3, C - 2, C + 8, C + 2, [C + 3, C]);
    w.map.structure[idx(C + 6, C)] = Structure.Bed;
    w.map.structure[idx(C + 6, C + 1)] = Structure.Bed;
    w.invalidateRooms();
    w.pawns[0]!.needs.sleep = 10;
    let g = 0;
    while (w.pawns[0]!.job === null && g++ < 50) w.tick();
    g = 0;
    while (w.pawns[0]!.job !== null && g++ < 3000) w.tick();
    const ids = w.pawns[0]!.thoughts.map((t) => t.id);
    expect(ids).toContain('sleptInBed');
    expect(ids).not.toContain('ownBedroom');
  });

  it('в кровати спят быстрее, чем на полу', () => {
    const sleepTicks = (withBed: boolean): number => {
      const w = arena();
      if (withBed) w.map.structure[idx(C + 1, C)] = Structure.Bed;
      w.pawns[0]!.needs.sleep = 10;
      let n = 0;
      let slept = false;
      while (n++ < 4000) {
        w.tick();
        if (w.pawns[0]!.job?.kind === 'sleep') slept = true;
        if (slept && w.pawns[0]!.job === null) break;
      }
      return n;
    };
    expect(sleepTicks(true)).toBeLessThan(sleepTicks(false));
  });

  it('разобранная кровать больше не закреплена', () => {
    const w = arena();
    w.map.structure[idx(C + 4, C)] = Structure.Bed;
    const p = w.pawns[0]!;
    p.needs.sleep = 10;
    run(w, 200);
    expect(p.ownedBed).not.toBeNull();
    while (p.job !== null) w.tick();
    w.map.structure[idx(C + 4, C)] = Structure.None;
    p.needs.sleep = 10;
    run(w, 5);
    expect(p.ownedBed).toBeNull();
    expect((p.job as { kind: string } | null)?.kind).toBe('sleep');
  });
});

describe('готовка', () => {
  it('плита превращает сырьё в обеды', () => {
    const w = arena();
    w.map.structure[idx(C + 3, C)] = Structure.Stove;
    w.items.put(idx(C - 3, C), 'rice', 9);
    run(w, 1500);
    expect(w.items.total('meal')).toBeGreaterThanOrEqual(COOK.meals);
    expect(w.items.total('rice')).toBeLessThan(9);
  });

  it('без плиты не готовят; при большом запасе обедов — тоже', () => {
    const w = arena();
    w.items.put(idx(C - 3, C), 'rice', 9);
    run(w, 600);
    expect(w.items.total('meal')).toBe(0);
    w.map.structure[idx(C + 3, C)] = Structure.Stove;
    w.items.put(idx(C - 3, C + 1), 'meal', 50);
    w.items.put(idx(C - 4, C + 1), 'meal', 50);
    const before = w.items.total('rice');
    run(w, 600);
    expect(w.items.total('rice')).toBe(before);
  });

  it('голодный предпочитает обед и получает мысль «вкусный ужин»', () => {
    const w = arena();
    w.items.put(idx(C + 2, C), 'rice', 10);
    w.items.put(idx(C - 2, C), 'meal', 4);
    const p = w.pawns[0]!;
    p.needs.food = 10;
    run(w, 300);
    expect(p.needs.food).toBeGreaterThan(80);
    expect(w.items.stacks.get(idx(C + 2, C))?.count).toBe(10); // рис не тронут
    expect(p.thoughts.map((t) => t.id)).toContain('ateMeal');
  });

  it('сырая еда даёт «ел сырое»', () => {
    const w = arena();
    w.items.put(idx(C + 2, C), 'rice', 10);
    const p = w.pawns[0]!;
    p.needs.food = 10;
    run(w, 300);
    expect(p.thoughts.map((t) => t.id)).toContain('ateRaw');
  });
});

describe('настроение', () => {
  it('база 50%, состояния и мысли складываются', () => {
    const w = arena();
    const p = w.pawns[0]!;
    expect(computeMood(p, 0)).toBe(MOOD.base);
    p.needs.food = 20;
    expect(computeMood(p, 0)).toBe(MOOD.base + STATE_MOODS.hungry);
    p.needs.food = 0;
    expect(computeMood(p, 0)).toBe(MOOD.base + STATE_MOODS.starving);
    addThought(p, 'ateMeal', 0);
    expect(computeMood(p, 0)).toBe(MOOD.base + STATE_MOODS.starving + THOUGHTS.ateMeal.value);
  });

  it('мысль проходит по истечении срока, повтор продлевает', () => {
    const w = arena();
    const p = w.pawns[0]!;
    addThought(p, 'ateMeal', 100);
    expect(moodEntries(p, 100 + THOUGHTS.ateMeal.ticks - 1)).toHaveLength(1);
    expect(moodEntries(p, 100 + THOUGHTS.ateMeal.ticks)).toHaveLength(0);
    addThought(p, 'ateMeal', 500);
    expect(p.thoughts).toHaveLength(1);
    expect(p.thoughts[0]!.until).toBe(500 + THOUGHTS.ateMeal.ticks);
  });

  it('настроение ограничено 0..100', () => {
    const w = arena();
    const p = w.pawns[0]!;
    for (const id of ['ateMeal', 'ownBedroom', 'catharsis', 'sleptInBed'] as const) addThought(p, id, 0);
    expect(computeMood(p, 0)).toBeLessThanOrEqual(100);
    p.thoughts = [];
    p.needs = { food: 0, sleep: 0, rest: 0 };
    addThought(p, 'sleptOnFloor', 0);
    expect(computeMood(p, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('срыв', () => {
  function crisis(w: World): void {
    const p = w.pawns[0]!;
    p.needs = { food: 0, sleep: 0, rest: 0 };
    addThought(p, 'sleptOnFloor', w.tickCount);
  }

  it('при настроении ниже порога поселенец бросает работу и бродит, потом приходит в себя', () => {
    const w = arena();
    w.map.set(C + 3, C, Terrain.Tree);
    w.applyOrder('chop', C + 3, C, C + 3, C);
    const p = w.pawns[0]!;
    run(w, 30);
    expect(p.job?.kind).toBe('chop');
    crisis(w);
    run(w, MOOD.updateEvery + 5);
    expect(p.breakUntil).not.toBeNull();
    expect(p.mood).toBeLessThan(MOOD.breakBelow);
    run(w, 5);
    expect(p.job?.kind).toBe('wander');
    // во время срыва дерево не рубится
    run(w, 30);
    expect(w.map.get(C + 3, C)).toBe(Terrain.Tree);
    const until = p.breakUntil!;
    expect(until - w.tickCount).toBeLessThanOrEqual(MOOD.breakMaxTicks);
    while (w.tickCount <= until + 2) {
      w.tick();
      p.needs.food = 0; // кризис не проходит
    }
    expect(p.breakUntil).toBeNull();
    expect(p.thoughts.map((t) => t.id)).toContain('catharsis');
  });

  it('после срыва сутки нового срыва нет', () => {
    const w = arena();
    const p = w.pawns[0]!;
    crisis(w);
    let g = 0;
    while (p.breakUntil === null && g++ < 200) w.tick();
    expect(p.breakUntil).not.toBeNull();
    const until = p.breakUntil!;
    g = 0;
    while (w.tickCount <= until + 1 && g++ < 1000) {
      w.tick();
      p.needs = { food: 0, sleep: 0, rest: 0 };
    }
    expect(p.breakUntil).toBeNull();
    const cooldownEnds = p.breakCooldownUntil;
    expect(cooldownEnds - w.tickCount).toBeGreaterThan(DAY_TICKS - 10);
    // кризис продолжается, но срыва нет
    for (let i = 0; i < 400; i++) {
      p.needs = { food: 0, sleep: 0, rest: 0 };
      w.tick();
      expect(p.breakUntil).toBeNull();
    }
  });

  it('поселенец с хорошим настроением не срывается', () => {
    const w = arena();
    run(w, 3000);
    expect(w.pawns[0]!.breakUntil).toBeNull();
  });

  it('срыв детерминирован и переживает сохранение', () => {
    const make = () => {
      const w = arena(2);
      w.applyOrder('chop', C - 8, C - 8, C + 8, C + 8);
      crisis(w);
      return w;
    };
    const a = make();
    run(a, MOOD.updateEvery * 3);
    expect(a.pawns[0]!.breakUntil).not.toBeNull();
    const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
    run(a, 800);
    run(b, 800);
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
  });

  it('сохранение без полей настроения (старое) загружается', () => {
    const w = arena();
    const s = serializeWorld(w) as unknown as { pawns: Record<string, unknown>[]; rng?: number };
    for (const p of s.pawns) for (const k of ['thoughts', 'mood', 'breakUntil', 'breakCooldownUntil', 'ownedBed']) delete p[k];
    delete s.rng;
    const back = restoreWorld(s)!;
    expect(back.pawns[0]!.thoughts).toEqual([]);
    expect(back.pawns[0]!.ownedBed).toBeNull();
    run(back, 100);
  });
});
