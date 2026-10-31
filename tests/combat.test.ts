import { describe, expect, it } from 'vitest';
import { COMBAT, DAY_TICKS, HEALTH, MAP_SIZE, WEAPONS } from '../src/sim/balance';
import { hitChance, los, pickPart, weaponDef } from '../src/sim/combat';
import { fireEvent } from '../src/sim/events';
import { addWound } from '../src/sim/health';
import { Structure, Terrain } from '../src/sim/map';
import { raidSize, spawnRaid, tickEnemies } from '../src/sim/raid';
import { Rng } from '../src/sim/rng';
import { restoreWorld, serializeWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function arena(pawns = 3): World {
  const w = new World(5, { pawnCount: pawns, startItems: false, quiet: true, fixedTemp: 20, stroll: false });
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  for (const p of w.pawns) p.needs = { food: 100, sleep: 100, rest: 100 };
  return w;
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) {
    for (const p of w.pawns) if (!p.dead) p.needs = { food: 100, sleep: 100, rest: 100 };
    w.tick();
  }
};
function raider(w: World, x: number, y: number, weapon: 'club' | 'bow' | null = 'club') {
  w.nextEnemyId++;
  const e = JSON.parse(JSON.stringify(w.pawns[0]));
  Object.assign(e, { id: 1000 + w.nextEnemyId, name: 'Гром', faction: 'raider', weapon, cx: x, cy: y, x, y, prevX: x, prevY: y, path: [], t: 0, traits: [], wounds: [], blood: 100, dead: false, downed: false });
  e.skills.shooting = 6;
  w.enemies.push(e);
  return e as (typeof w.enemies)[number];
}

describe('оружие и попадание', () => {
  it('таблица оружия: дубина бьёт вплотную, лук стреляет далеко', () => {
    expect(WEAPONS.club.melee).toBe(true);
    expect(WEAPONS.bow.melee).toBe(false);
    expect(WEAPONS.bow.range).toBeGreaterThan(WEAPONS.club.range * 3);
    expect(WEAPONS.club.max).toBeGreaterThan(WEAPONS.fists.max);
    const p = arena(1).pawns[0]!;
    expect(weaponDef(p).label).toBe('Кулаки');
    p.weapon = 'club';
    expect(weaponDef(p).label).toBe('Дубина');
  });

  it('меткость растёт с навыком, падает с дистанцией и укрытием, ранения мешают', () => {
    const p = arena(1).pawns[0]!;
    p.weapon = 'bow';
    p.skills.shooting = 2;
    const low = hitChance(p, 5, false);
    p.skills.shooting = 14;
    const high = hitChance(p, 5, false);
    expect(high).toBeGreaterThan(low);
    expect(hitChance(p, 9, false)).toBeLessThan(high);
    expect(hitChance(p, 5, true)).toBeCloseTo(high * COMBAT.coverFactor, 9);
    addWound(p, 'armL', 'cut', 15);
    addWound(p, 'armR', 'cut', 15);
    expect(hitChance(p, 5, false)).toBeLessThan(high);
    p.weapon = 'club';
    p.wounds = [];
    expect(hitChance(p, 1, true)).toBe(COMBAT.meleeHit); // укрытие не мешает в ближнем бою
  });

  it('попадания распределяются по всем частям тела, чаще всего по торсу', () => {
    const rng = new Rng(1);
    const count: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const part = pickPart(rng);
      count[part] = (count[part] ?? 0) + 1;
    }
    expect(Object.keys(count)).toHaveLength(6);
    expect(count.torso!).toBeGreaterThan(count.head! * 2);
  });

  it('стены и скалы закрывают обзор; плита и кровать дают укрытие', () => {
    const w = arena(1);
    expect(los(w.map, 10, 10, 20, 10)).toEqual({ clear: true, cover: false });
    w.map.structure[idx(15, 10)] = Structure.Wall;
    expect(los(w.map, 10, 10, 20, 10).clear).toBe(false);
    w.map.structure[idx(15, 10)] = Structure.None;
    w.map.structure[idx(19, 10)] = Structure.Stove;
    expect(los(w.map, 10, 10, 20, 10)).toEqual({ clear: true, cover: true });
    w.map.structure[idx(19, 10)] = Structure.None;
    w.map.set(15, 10, Terrain.Stone);
    expect(los(w.map, 10, 10, 20, 10).clear).toBe(false);
    w.map.set(15, 10, Terrain.Grass);
    w.map.set(19, 10, Terrain.Tree);
    expect(los(w.map, 10, 10, 20, 10).cover).toBe(true);
  });
});

describe('бой', () => {
  it('налётчик с дубиной бьёт колониста вплотную и ранит его', () => {
    const w = arena(1);
    w.pawns[0]!.traits = [];
    const e = raider(w, C + 4, C);
    w.setAlarm(false);
    run(w, 300);
    expect(w.pawns[0]!.wounds.length + (w.pawns[0]!.dead ? 1 : 0)).toBeGreaterThan(0);
    expect(Math.hypot(e.x - w.pawns[0]!.x, e.y - w.pawns[0]!.y)).toBeLessThan(2);
  });

  it('стрелок бьёт издалека, но стена мешает ему', () => {
    const open = arena(1);
    const a = raider(open, C - 8, C, 'bow');
    run(open, 200);
    expect(open.pawns[0]!.wounds.length).toBeGreaterThan(0);
    expect(Math.hypot(a.x - open.pawns[0]!.x, a.y - open.pawns[0]!.y)).toBeGreaterThan(2); // не подошёл вплотную

    const walled = arena(1);
    for (let y = C - 6; y <= C + 6; y++) walled.map.structure[idx(C - 4, y)] = Structure.Wall;
    const b = raider(walled, C - 8, C, 'bow');
    run(walled, 40);
    expect(walled.pawns[0]!.wounds.length).toBe(0); // через стену не стреляют
    expect(b.path.length).toBeGreaterThan(0); // зато обходит
  });

  it('при тревоге колонисты берут дубины и побеждают двух налётчиков', () => {
    const w = arena(3);
    w.items.put(idx(C - 2, C - 2), 'club', 2);
    raider(w, C + 9, C);
    raider(w, C + 10, C + 1);
    w.setAlarm(true);
    w.story.raidActive = true;
    run(w, 1500);
    expect(w.pawns.filter((p) => p.weapon === 'club').length).toBe(2);
    expect(w.enemies.every((e) => e.dead || e.downed || e.fleeing)).toBe(true);
    expect(w.living.length).toBeGreaterThanOrEqual(2);
  });

  it('без тревоги колонисты не бросают дела ради налётчиков (но защищаются, если их бьют — только при тревоге)', () => {
    const w = arena(1);
    w.map.set(C - 3, C, Terrain.Tree);
    w.applyOrder('chop', C - 3, C, C - 3, C);
    raider(w, C + 15, C);
    run(w, 80);
    expect(w.pawns[0]!.job?.kind).not.toBe('fight');
  });

  it('налётчики бегут, когда выбыла половина отряда, и уходят за край карты', () => {
    const w = arena(3);
    w.items.put(idx(C - 2, C - 2), 'club', 3);
    for (let i = 0; i < 4; i++) raider(w, C + 10 + i, C);
    w.story.raidActive = true;
    w.setAlarm(true);
    w.enemies[0]!.dead = true;
    w.enemies[1]!.dead = true;
    run(w, 5);
    expect(w.enemies.filter((e) => e.fleeing).length).toBe(2);
    expect(w.log.some((l) => l.text.includes('бегство'))).toBe(true);
    run(w, 1500);
    expect(w.enemies.filter((e) => !e.dead && !e.downed)).toHaveLength(0);
    expect(w.story.raidActive).toBe(false);
    expect(w.story.raidsDone).toBe(1);
  });

  it('отступающий налётчик находит выход, даже если ближайшая точка края закрыта', () => {
    const w = arena(1);
    // Все края закрыты, кроме единственного выхода далеко от ближайшей точки.
    for (let i = 0; i < MAP_SIZE; i++) {
      w.map.set(i, 0, Terrain.Stone);
      w.map.set(i, MAP_SIZE - 1, Terrain.Stone);
      w.map.set(0, i, Terrain.Stone);
      w.map.set(MAP_SIZE - 1, i, Terrain.Stone);
    }
    w.map.set(MAP_SIZE - 1, C, Terrain.Grass);
    const e = raider(w, 2, C);
    e.fleeing = true;
    w.story.raidActive = true;
    w.alarm = true;
    w.alarmAuto = true;
    for (let i = 0; i < 2000 && w.story.raidActive; i++) tickEnemies(w);
    expect(w.enemies).toHaveLength(0);
    expect(w.story.raidActive).toBe(false);
    expect(w.story.raidsDone).toBe(1);
    expect(w.alarm).toBe(false);
  });

  it('окружённый налётчик прекращает старый путь и уходит после открытия прохода', () => {
    const w = arena(1);
    const e = raider(w, C, C);
    e.fleeing = true;
    e.aiTimer = 0;
    e.path = [{ x: C + 1, y: C }];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) w.map.structure[idx(C + dx, C + dy)] = Structure.Wall;
    }
    w.story.raidActive = true;
    tickEnemies(w);
    expect(e.path).toEqual([]);
    expect(e.x).toBe(C);
    expect(e.y).toBe(C);
    expect(w.story.raidActive).toBe(true);
    w.map.structure[idx(C + 1, C)] = Structure.None;
    for (let i = 0; i < 1500 && w.story.raidActive; i++) tickEnemies(w);
    expect(w.enemies).toHaveLength(0);
    expect(w.story.raidActive).toBe(false);
  });

  it('павший налётчик роняет оружие', () => {
    const w = arena(1);
    const e = raider(w, C + 5, C, 'bow');
    w.hurt(e, 'head', 'blunt', HEALTH.partMax.head);
    expect(e.dead).toBe(true);
    expect(w.items.total('bow')).toBe(1);
    expect(w.log.some((l) => l.text.startsWith('Налётчик пал'))).toBe(true);
    expect(w.living).toHaveLength(1); // налётчики не считаются колонистами
  });

  it('трупы налётчиков убираются через сутки', () => {
    const w = arena(1);
    const e = raider(w, C + 5, C);
    w.hurt(e, 'head', 'blunt', 99);
    run(w, COMBAT.enemyCorpseTicks + 10);
    expect(w.enemies).toHaveLength(0);
  });
});

describe('набеги', () => {
  it('размер набега растёт с числом набегов и колонистов', () => {
    const w = arena(3);
    const a = raidSize(w).count;
    w.story.raidsDone = 6;
    expect(raidSize(w).count).toBeGreaterThan(a);
    expect(raidSize(w).bows).toBeGreaterThan(0);
    w.story.raidsDone = 99;
    expect(raidSize(w).count).toBeLessThanOrEqual(COMBAT.raidMaxSize);
    w.story.raidsDone = 0;
    expect(raidSize(w).bows).toBe(0); // первые набеги — только дубины
  });

  it('спавн: налётчики появляются у края карты, откуда есть дорога', () => {
    const w = arena(3);
    expect(spawnRaid(w, 4, 1)).toBe(true);
    expect(w.enemies).toHaveLength(4);
    for (const e of w.enemies) expect(e.faction).toBe('raider');
    expect(w.enemies.filter((e) => e.weapon === 'bow')).toHaveLength(1);
    const e = w.enemies[0]!;
    expect(Math.min(e.cx, e.cy, MAP_SIZE - 1 - e.cx, MAP_SIZE - 1 - e.cy)).toBeLessThanOrEqual(6);
  });

  it('вызванный набег: предупреждение, тревога, прибытие, конец', () => {
    const w = arena(3);
    w.items.put(idx(C - 2, C - 2), 'club', 3);
    expect(fireEvent(w, 'raid')).toBe(true);
    expect(w.story.raid).not.toBeNull();
    expect(w.alarm).toBe(true);
    expect(w.alarmAuto).toBe(true);
    expect(w.log.some((l) => l.text.startsWith('Приближается набег'))).toBe(true);
    expect(fireEvent(w, 'raid')).toBe(false); // второй сразу нельзя
    run(w, COMBAT.warningTicks + 5);
    expect(w.story.raidActive).toBe(true);
    expect(w.enemies.length).toBeGreaterThanOrEqual(2);
    run(w, 4000);
    expect(w.story.raidActive).toBe(false);
    expect(w.alarm).toBe(false); // автотревога сама выключилась
    expect(w.log.some((l) => l.text === 'Набег отбит' || l.text.startsWith('Налётчики ушли'))).toBe(true);
  });

  it('до 15-х суток случайных набегов нет, после — бывают; мирный режим их отключает', () => {
    const early = new World(2, { ai: false, startItems: false });
    for (let i = 0; i < DAY_TICKS * 12; i++) early.tick();
    expect(early.log.some((l) => l.text.includes('набег'))).toBe(false);

    const count = (peaceful: boolean) => {
      let raids = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const w = new World(seed, { ai: false, startItems: false });
        w.story.peaceful = peaceful;
        w.tickCount = DAY_TICKS * 14; // сразу к концу порога
        for (let i = 0; i < DAY_TICKS * 25; i++) {
          w.tick();
          if (w.living.length === 0) break;
        }
        raids += w.log.filter((l) => l.text.startsWith('Приближается набег')).length;
      }
      return raids;
    };
    expect(count(false)).toBeGreaterThan(0);
    expect(count(true)).toBe(0);
  });

  it('ручная тревога не выключается сама', () => {
    const w = arena(1);
    w.setAlarm(true);
    expect(w.alarmAuto).toBe(false);
    raider(w, C + 5, C);
    w.story.raidActive = true;
    w.enemies[0]!.dead = true;
    run(w, 5);
    expect(w.story.raidActive).toBe(false);
    expect(w.alarm).toBe(true);
  });
});

describe('сохранение боя', () => {
  it('налётчики, тревога и оружие переживают сохранение; бой идёт тем же ходом', () => {
    const a = arena(3);
    a.items.put(idx(C - 2, C - 2), 'club', 3);
    raider(a, C + 8, C);
    raider(a, C + 9, C + 1, 'bow');
    a.setAlarm(true);
    a.story.raidActive = true;
    run(a, 200);
    const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
    expect(b.enemies).toHaveLength(2);
    expect(b.alarm).toBe(true);
    expect(b.pawns.map((p) => p.weapon)).toEqual(a.pawns.map((p) => p.weapon));
    run(a, 800);
    run(b, 800);
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
  });

  it('сохранение версии 4 (без боя) загружается', () => {
    const w = new World(3);
    for (let i = 0; i < 200; i++) w.tick();
    const s = serializeWorld(w) as unknown as Record<string, unknown> & { pawns: Record<string, unknown>[]; story: Record<string, unknown> };
    s.version = 4;
    for (const k of ['enemies', 'alarm', 'alarmAuto', 'nextEnemyId']) delete s[k];
    for (const k of ['raid', 'raidActive', 'raidFled', 'raidsDone', 'peaceful']) delete s.story[k];
    for (const p of s.pawns) for (const k of ['weapon', 'faction', 'attackCooldown', 'aiTimer', 'fleeing']) delete p[k];
    const back = restoreWorld(JSON.parse(JSON.stringify(s)))!;
    expect(back).not.toBeNull();
    expect(back.enemies).toEqual([]);
    expect(back.story.peaceful).toBe(false);
    for (let i = 0; i < 300; i++) back.tick();
  });
});

describe('баланс боя', () => {
  it('три вооружённых колониста почти всегда отбивают первый набег без потерь', () => {
    let wins = 0;
    let deaths = 0;
    const N = 12;
    for (let seed = 1; seed <= N; seed++) {
      const w = new World(seed, { pawnCount: 3, startItems: false, quiet: true, fixedTemp: 20, stroll: false });
      for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) w.map.set(x, y, Terrain.Grass);
      w.map.bushes.clear();
      w.items.put(idx(C - 2, C - 2), 'club', 3);
      fireEvent(w, 'raid');
      for (let i = 0; i < 6000; i++) {
        for (const p of w.pawns) if (!p.dead) p.needs = { food: 100, sleep: 100, rest: 100 };
        w.tick();
        if (!w.story.raidActive && !w.story.raid && w.tickCount > COMBAT.warningTicks + 50) break;
      }
      if (!w.story.raidActive) wins++;
      deaths += w.pawns.filter((p) => p.dead).length;
    }
    expect(wins).toBe(N);
    expect(deaths / N).toBeLessThan(0.5);
  }, 60_000);
});

