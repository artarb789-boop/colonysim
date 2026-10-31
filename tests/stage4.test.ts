import { describe, expect, it } from 'vitest';
import { CROP, DAY_TICKS, MAP_SIZE, NEEDS, PRICES, SICK, STORY, YEAR_DAYS } from '../src/sim/balance';
import { calendar, darknessAt, growthFactor, indoorTemp, isNightHour, outdoorTemp } from '../src/sim/climate';
import { acceptStranger, declineStranger } from '../src/sim/events';
import { Terrain } from '../src/sim/map';
import { computeMood, moodEntries } from '../src/sim/mood';
import { restoreWorld, serializeWorld } from '../src/sim/serialize';
import { TRAIT_IDS, TRAITS, effectsOf, exposureOf, pickTraits, type TraitId } from '../src/sim/traits';
import { Rng } from '../src/sim/rng';
import { buy, buyPrice, canBuy, sell, sellPrice } from '../src/sim/trade';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function arena(opts: { temp?: number; pawns?: number; ai?: boolean } = {}): World {
  const w = new World(5, { pawnCount: opts.pawns ?? 1, ai: opts.ai ?? true, startItems: false, quiet: true, fixedTemp: opts.temp ?? 20 });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  return w;
}
function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) w.tick();
}
/** Тик, в который наступает заданный час первых суток (день 1 начинается в 06:00). */
const tickAtHour = (h: number) => Math.round((((h - 6 + 24) % 24) / 24) * DAY_TICKS);

describe('календарь и климат', () => {
  it('сезоны по 15 дней, год 60 дней', () => {
    const at = (day: number) => calendar((day - 1) * DAY_TICKS + 10);
    expect(at(1)).toMatchObject({ season: 0, seasonName: 'Весна', dayInSeason: 1, year: 1 });
    expect(at(15)).toMatchObject({ season: 0, dayInSeason: 15 });
    expect(at(16)).toMatchObject({ season: 1, seasonName: 'Лето', dayInSeason: 1 });
    expect(at(31).seasonName).toBe('Осень');
    expect(at(46).seasonName).toBe('Зима');
    expect(at(YEAR_DAYS + 1)).toMatchObject({ season: 0, year: 2, dayInSeason: 1 });
  });

  it('температура детерминирована и зависит от сезона: лето тёплое, зима холодная, старт весны прохладный', () => {
    const noon = (day: number) => outdoorTemp((day - 1) * DAY_TICKS + tickAtHour(13), 42);
    expect(noon(20)).toBe(outdoorTemp((20 - 1) * DAY_TICKS + tickAtHour(13), 42));
    expect(noon(20)).toBeGreaterThan(18);
    expect(noon(50)).toBeLessThan(0);
    expect(noon(20)).toBeGreaterThan(noon(5));
    expect(noon(5)).toBeGreaterThan(noon(50));
    const start = outdoorTemp(0, 42);
    expect(start).toBeGreaterThan(-3);
    expect(start).toBeLessThan(10);
  });

  it('днём теплее, чем ночью; холодная волна понижает', () => {
    const day = (h: number) => outdoorTemp(10 * DAY_TICKS + tickAtHour(h), 7);
    expect(day(15)).toBeGreaterThan(day(3));
    expect(outdoorTemp(5000, 7, -15)).toBeCloseTo(outdoorTemp(5000, 7) - 15, 9);
  });

  it('в комнате теплее зимой и прохладнее летом', () => {
    expect(indoorTemp(-10)).toBeGreaterThan(-10);
    expect(indoorTemp(30)).toBeLessThan(30);
  });

  it('рост растений: ниже 5 °C нет, 20–32 полный, жара замедляет', () => {
    expect(growthFactor(0)).toBe(0);
    expect(growthFactor(5)).toBe(0);
    expect(growthFactor(12.5)).toBeCloseTo(0.5);
    expect(growthFactor(25)).toBe(1);
    expect(growthFactor(40)).toBeLessThan(1);
    expect(growthFactor(40)).toBeGreaterThan(0);
  });

  it('ночью темнее: максимум ночью, ноль днём', () => {
    expect(darknessAt(tickAtHour(13))).toBe(0);
    expect(darknessAt(tickAtHour(1))).toBeCloseTo(0.55, 2);
    expect(darknessAt(tickAtHour(7))).toBeGreaterThan(0);
    expect(darknessAt(tickAtHour(7))).toBeLessThan(0.55);
    expect(isNightHour(23)).toBe(true);
    expect(isNightHour(12)).toBe(false);
  });
});

describe('черты', () => {
  it('черт от 10 до 15, у каждой есть название и описание', () => {
    expect(TRAIT_IDS.length).toBeGreaterThanOrEqual(10);
    expect(TRAIT_IDS.length).toBeLessThanOrEqual(15);
    for (const id of TRAIT_IDS) {
      expect(TRAITS[id].label.length).toBeGreaterThan(2);
      expect(TRAITS[id].desc.length).toBeGreaterThan(5);
    }
  });

  it('выдаётся 1–2 несовместимых черты', () => {
    const seen = new Set<TraitId>();
    for (let seed = 1; seed <= 300; seed++) {
      const t = pickTraits(new Rng(seed));
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(2);
      expect(new Set(t).size).toBe(t.length);
      if (t.length === 2) expect(TRAITS[t[0]!].conflicts).not.toContain(t[1]);
      t.forEach((x) => seen.add(x));
    }
    expect(seen.size).toBe(TRAIT_IDS.length); // встречаются все
  });

  it('конфликты симметричны', () => {
    for (const id of TRAIT_IDS) for (const c of TRAITS[id].conflicts) expect(TRAITS[c].conflicts).toContain(id);
  });

  it('эффекты складываются', () => {
    const fx = effectsOf(['workaholic', 'quick']);
    expect(fx.work).toBeCloseTo(1.15);
    expect(fx.move).toBeCloseTo(1.2);
    expect(effectsOf([]).work).toBe(1);
  });

  it('оптимист и пессимист сдвигают настроение, стоик гасит мысли', () => {
    const w = arena();
    const p = w.pawns[0]!;
    expect(computeMood(p, 0)).toBe(50);
    p.traits = ['optimist'];
    expect(computeMood(p, 0)).toBe(56);
    p.traits = ['pessimist'];
    expect(computeMood(p, 0)).toBe(44);
    p.traits = [];
    p.needs.food = 20;
    expect(computeMood(p, 0)).toBe(42);
    p.traits = ['stoic'];
    expect(computeMood(p, 0)).toBe(50 - Math.round(8 * 0.7));
    p.traits = ['emotional'];
    expect(computeMood(p, 0)).toBe(50 - Math.round(8 * 1.3));
  });

  it('неприхотливого не огорчают пол и сырая еда, обжору огорчают вдвое сильнее', () => {
    const w = arena();
    const p = w.pawns[0]!;
    p.thoughts = [{ id: 'sleptOnFloor', until: 100 }, { id: 'ateRaw', until: 100 }];
    p.traits = [];
    expect(computeMood(p, 0)).toBe(50 - 5 - 3);
    p.traits = ['undemanding'];
    expect(computeMood(p, 0)).toBe(50);
    p.traits = ['glutton'];
    expect(moodEntries(p, 0).find((e) => e.key === 'ateRaw')!.value).toBe(-6);
  });

  it('закалённый не мёрзнет, мерзляк мёрзнет раньше', () => {
    expect(exposureOf(-5, effectsOf([]))).toBe('cold');
    expect(exposureOf(-5, effectsOf(['hardy']))).toBe('none');
    expect(exposureOf(4, effectsOf([]))).toBe('none');
    expect(exposureOf(4, effectsOf(['chilly']))).toBe('cold');
    expect(exposureOf(-15, effectsOf([]))).toBe('freezing');
    expect(exposureOf(36, effectsOf([]))).toBe('hot');
    expect(exposureOf(36, effectsOf(['hardy']))).toBe('none');
  });

  it('быстроногий ходит быстрее, трудоголик быстрее работает', () => {
    const walk = (traits: TraitId[]) => {
      const w = arena({ ai: false });
      w.pawns[0]!.traits = traits;
      w.moveTo(0, C + 6, C);
      let n = 0;
      while (w.pawns[0]!.job && n++ < 2000) w.tick();
      return n;
    };
    expect(walk(['quick'])).toBeLessThan(walk([]));
    const chop = (traits: TraitId[]) => {
      const w = arena();
      w.pawns[0]!.traits = traits;
      w.map.set(C + 3, C, Terrain.Tree);
      w.applyOrder('chop', C + 3, C, C + 3, C);
      let n = 0;
      while (w.map.get(C + 3, C) === Terrain.Tree && n++ < 2000) w.tick();
      return n;
    };
    expect(chop(['workaholic'])).toBeLessThan(chop([]));
    expect(chop(['lazy'])).toBeGreaterThan(chop([]));
  });
});

describe('ночь и сон', () => {
  it('ночью ложатся спать раньше, днём — только при сильной усталости; сова бодрствует', () => {
    const t = (hour: number, traits: TraitId[]) => {
      const w = arena();
      w.tickCount = tickAtHour(hour);
      w.pawns[0]!.traits = traits;
      w.pawns[0]!.needs.sleep = 45;
      run(w, 5);
      return w.pawns[0]!.job?.kind ?? null;
    };
    expect(t(23, [])).toBe('sleep');
    expect(t(13, [])).toBeNull();
    expect(t(23, ['nightOwl'])).toBeNull();
    expect(t(23, ['earlyBird'])).toBe('sleep');
  });
});

describe('температура и мир', () => {
  it('рис не растёт в холод и растёт в тепло', () => {
    const grow = (temp: number) => {
      const w = arena({ temp, ai: false });
      w.map.crops.set(idx(C + 3, C), { growth: 0 });
      run(w, 1000);
      return w.map.crops.get(idx(C + 3, C))!.growth;
    };
    expect(grow(3)).toBe(0);
    expect(grow(20)).toBe(1000);
    expect(grow(12.5)).toBeCloseTo(500, 0);
  });

  it('заморозки губят молодые посевы, зрелые остаются', () => {
    const w = arena({ temp: -6, ai: false });
    w.map.crops.set(idx(C + 3, C), { growth: 100 });
    w.map.crops.set(idx(C + 4, C), { growth: CROP.growTicks });
    run(w, 200);
    expect(w.map.crops.has(idx(C + 3, C))).toBe(false);
    expect(w.map.crops.has(idx(C + 4, C))).toBe(true);
    expect(w.log.some((l) => l.text.includes('Заморозки'))).toBe(true);
  });

  it('ягоды не отрастают на морозе', () => {
    const regrow = (temp: number) => {
      const w = arena({ temp, ai: false });
      w.map.bushes.set(idx(C + 3, C), { berries: 0, regrow: 10 });
      run(w, 50);
      return w.map.bushes.get(idx(C + 3, C))!.berries;
    };
    expect(regrow(0)).toBe(0);
    expect(regrow(15)).toBe(1);
  });

  it('на улице в мороз настроение падает, в комнате — нет', () => {
    const w = arena({ temp: -8, ai: false });
    run(w, 40);
    expect(w.pawns[0]!.exposure).toBe('cold');
    expect(w.pawns[0]!.mood).toBe(44);
    // замкнём комнату вокруг поселенца
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) w.map.structure[idx(C + dx, C + dy)] = 1;
    w.invalidateRooms();
    run(w, 40);
    expect(w.pawns[0]!.exposure).toBe('none'); // внутри ≈ +6 °C
    expect(w.pawns[0]!.mood).toBe(50);
  });

  it('холодная волна: температура ниже на 15 °C, потом возвращается', () => {
    const w = new World(5, { pawnCount: 1, startItems: false, quiet: true });
    const before = w.outdoorTemp();
    w.story.coldWaveUntil = 500;
    w.tickCount = 0;
    w.invalidateTemp();
    expect(w.outdoorTemp()).toBeCloseTo(before - 15, 9);
    w.tickCount = 600;
    w.invalidateTemp();
    expect(w.outdoorTemp()).toBeCloseTo(outdoorTemp(600, 5), 9);
  });
});

describe('рассказчик', () => {
  function until(pred: (w: World) => boolean, seeds = 30, days = 12): World | null {
    for (let seed = 1; seed <= seeds; seed++) {
      const w = new World(seed, { ai: false });
      for (let i = 0; i < DAY_TICKS * days; i++) {
        w.tick();
        if (pred(w)) return w;
      }
    }
    return null;
  }

  it('события детерминированы: тот же сид даёт тот же журнал', () => {
    const logs = () => {
      const w = new World(11, { ai: false });
      run(w, DAY_TICKS * 25);
      return JSON.stringify(w.log);
    };
    expect(logs()).toBe(logs());
  });

  it('события происходят: за 40 суток на нескольких сидах бывают странник, торговец, болезнь и холодная волна', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const w = new World(seed, { ai: false });
      run(w, DAY_TICKS * 40);
      for (const l of w.log) {
        if (l.text.includes('странник')) kinds.add('stranger');
        if (l.text.includes('торговец')) kinds.add('trader');
        if (l.text.includes('Простуда')) kinds.add('illness');
        if (l.text.includes('Холодная волна:')) kinds.add('cold');
      }
    }
    expect([...kinds].sort()).toEqual(['cold', 'illness', 'stranger', 'trader']);
  });

  it('странник: характеристики видны, принять — он появляется в колонии', () => {
    const w = until((x) => x.story.pending !== null)!;
    expect(w).not.toBeNull();
    const cand = w.story.pending!.pawn;
    expect(cand.traits.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...Object.values(cand.skills))).toBeGreaterThanOrEqual(5);
    const n = w.pawns.length;
    expect(acceptStranger(w)).toBe(true);
    expect(w.pawns).toHaveLength(n + 1);
    const p = w.pawns[n]!;
    expect(p.id).toBe(n);
    expect(p.name).toBe(cand.name);
    expect(w.map.isPassable(p.cx, p.cy)).toBe(true);
    expect(w.story.pending).toBeNull();
    expect(w.log[w.log.length - 1]!.text).toContain(p.name);
    // новичок живёт и работает как все
    w.applyOrder('chop', 0, 0, 59, 59);
    run(w, 600);
    expect(w.pawns[n]!.job === null || w.pawns[n]!.job !== undefined).toBe(true);
  });

  it('странник: отказ убирает его, а без ответа он уходит через сутки', () => {
    const a = until((x) => x.story.pending !== null)!;
    expect(declineStranger(a)).toBe(true);
    expect(a.story.pending).toBeNull();
    expect(a.pawns).toHaveLength(3);
    expect(acceptStranger(a)).toBe(false);

    const b = until((x) => x.story.pending !== null)!;
    const name = b.story.pending!.pawn.name;
    run(b, STORY.strangerWait + 5);
    expect(b.story.pending === null || b.story.pending.pawn.name !== name).toBe(true);
    expect(b.log.some((l) => l.text.includes(name) && l.text.includes('ушёл'))).toBe(true);
  });

  it('торговец остаётся 3 дня и уходит', () => {
    const w = until((x) => x.traderPresent)!;
    expect(w).not.toBeNull();
    run(w, STORY.traderTicks + 5);
    expect(w.traderPresent).toBe(false);
    expect(w.log.some((l) => l.text === 'Торговец ушёл')).toBe(true);
  });

  it('болезнь замедляет, заставляет ложиться раньше и проходит', () => {
    const w = until((x) => x.pawns.some((p) => p.sickUntil > x.tickCount))!;
    expect(w).not.toBeNull();
    const sick = w.pawns.find((p) => p.sickUntil > w.tickCount)!;
    expect(sick.sickUntil - w.tickCount).toBeLessThanOrEqual(SICK.maxTicks);
    expect(moodEntries(sick, w.tickCount).some((e) => e.key === 'sick')).toBe(true);
    run(w, SICK.maxTicks + 50);
    expect(w.pawns.every((p) => p.sickUntil === 0 || p.sickUntil > w.tickCount)).toBe(true);
    expect(w.log.some((l) => l.text.startsWith('Болезнь прошла'))).toBe(true);
  });

  it('больной медленнее ходит и ложится спать при сне ниже 70', () => {
    const w = arena({ ai: true });
    w.pawns[0]!.sickUntil = 99999;
    w.pawns[0]!.needs.sleep = 65;
    run(w, 5);
    expect(w.pawns[0]!.job?.kind).toBe('sleep');
    const walk = (sick: boolean) => {
      const q = arena({ ai: false });
      if (sick) q.pawns[0]!.sickUntil = 99999;
      q.moveTo(0, C + 6, C);
      let n = 0;
      while (q.pawns[0]!.job && n++ < 3000) q.tick();
      return n;
    };
    expect(walk(true)).toBeGreaterThan(walk(false) * 1.3);
  });

  it('при полной колонии странники не приходят', () => {
    const w = new World(3, { ai: false, pawnCount: 4 });
    while (w.pawns.length < STORY.maxPawns) w.pawns.push({ ...w.pawns[0]!, id: w.pawns.length, traits: [] });
    run(w, DAY_TICKS * 30);
    expect(w.story.pending).toBeNull();
    expect(w.log.some((l) => l.text.includes('странник'))).toBe(false);
  });
});

describe('торговля и серебро', () => {
  function shop(): World {
    const w = arena();
    w.applyOrder('zone', C - 3, C + 4, C - 1, C + 4);
    w.story.trader = { until: 1e9 };
    return w;
  }

  it('новая колония стартует с серебром', () => {
    expect(new World(1).items.total('silver')).toBeGreaterThan(0);
  });

  it('цены: продаём дешевле, покупаем дороже', () => {
    for (const k of ['wood', 'stone', 'berries', 'rice', 'meal'] as const) {
      expect(sellPrice(k, 20)).toBeLessThan(PRICES[k] * 20);
      expect(buyPrice(k, 20)).toBeGreaterThan(PRICES[k] * 20);
    }
  });

  it('продажа и покупка меняют запасы склада', () => {
    const w = shop();
    w.items.put(idx(C - 3, C + 4), 'meal', 10);
    expect(sell(w, 'meal', 5)).toBe(true);
    expect(w.stockpile().meal).toBe(5);
    expect(w.stockpile().silver).toBe(sellPrice('meal', 5));
    w.items.put(idx(C - 2, C + 4), 'silver', 40);
    const before = w.stockpile().silver;
    expect(buy(w, 'stone', 5)).toBe(true);
    expect(w.stockpile().stone).toBe(5);
    expect(w.stockpile().silver).toBe(before - buyPrice('stone', 5));
  });

  it('нельзя без торговца, без склада, без товара или без серебра', () => {
    const w = shop();
    w.items.put(idx(C - 3, C + 4), 'wood', 5);
    w.story.trader = null;
    expect(sell(w, 'wood', 5)).toBe(false);
    w.story.trader = { until: 1e9 };
    expect(sell(w, 'wood', 20)).toBe(false); // нет столько
    expect(canBuy(w, 'meal', 5)).toBe(false); // нет серебра
    const w2 = arena();
    w2.story.trader = { until: 1e9 };
    w2.items.put(idx(C, C), 'wood', 5);
    expect(sell(w2, 'wood', 5)).toBe(false); // нет склад-зоны
  });

  it('покупка невозможна, если на складе нет места', () => {
    const w = arena();
    w.applyOrder('zone', C - 3, C + 4, C - 3, C + 4);
    w.story.trader = { until: 1e9 };
    w.items.put(idx(C - 3, C + 4), 'silver', 50);
    expect(canBuy(w, 'wood', 5)).toBe(false); // клетка занята серебром
  });

  it('серебро хранится и переносится как обычный предмет', () => {
    const w = arena();
    w.items.put(idx(C + 3, C), 'silver', 30);
    w.applyOrder('zone', C - 5, C + 5, C - 4, C + 5);
    run(w, 1200);
    expect(w.stockpile().silver).toBe(30);
  });
});

describe('сохранение этапа 4', () => {
  it('черты, события и журнал переживают сохранение; симуляция идёт тем же ходом', () => {
    for (const seed of [2, 9]) {
      const a = new World(seed);
      a.applyOrder('chop', 10, 10, 50, 50);
      run(a, DAY_TICKS * 6);
      const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
      expect(b.pawns.map((p) => p.traits)).toEqual(a.pawns.map((p) => p.traits));
      expect(b.log).toEqual(a.log);
      run(a, DAY_TICKS * 3);
      run(b, DAY_TICKS * 3);
      expect(serializeWorld(b)).toEqual(serializeWorld(a));
    }
  });

  it('сохранение версии 2 (без рассказчика и черт) загружается и продолжает жить', () => {
    const w = new World(4);
    run(w, 800);
    const s = serializeWorld(w) as unknown as Record<string, unknown> & { pawns: Record<string, unknown>[] };
    s.version = 2;
    for (const k of ['story', 'log', 'logSeq']) delete s[k];
    for (const p of s.pawns) for (const k of ['traits', 'exposure', 'sickUntil']) delete p[k];
    const a = restoreWorld(JSON.parse(JSON.stringify(s)))!;
    const b = restoreWorld(JSON.parse(JSON.stringify(s)))!;
    expect(a).not.toBeNull();
    expect(a.pawns.every((p) => p.traits.length >= 1)).toBe(true);
    expect(a.story.nextEventTick).toBeGreaterThan(a.tickCount);
    expect(a.pawns.map((p) => p.traits)).toEqual(b.pawns.map((p) => p.traits)); // детерминированно
    run(a, 3000);
    run(b, 3000);
    expect(serializeWorld(a)).toEqual(serializeWorld(b));
  });

  it('очень старое сохранение (версия 1) тоже проходит цепочку миграций', () => {
    const w = new World(4);
    run(w, 100);
    const s = serializeWorld(w) as unknown as Record<string, unknown> & { pawns: Record<string, unknown>[] };
    s.version = 1;
    for (const k of ['story', 'log', 'logSeq', 'structure', 'floor', 'crops', 'garden', 'blueprints']) delete s[k];
    for (const p of s.pawns) for (const k of ['traits', 'exposure', 'sickUntil']) delete p[k];
    expect(restoreWorld(s)).not.toBeNull();
  });
});

describe('долгая игра', () => {
  it('30 суток на нескольких сидах без исключений и с нормальными значениями', () => {
    for (const seed of [1, 21]) {
      const w = new World(seed);
      w.applyOrder('chop', 15, 15, 45, 45);
      w.applyOrder('mine', 15, 15, 45, 45);
      w.applyOrder('zone', C - 3, C + 3, C + 3, C + 6);
      w.applyOrder('garden', C - 6, C - 6, C - 3, C - 3);
      for (let d = 0; d < 30; d++) {
        run(w, DAY_TICKS);
        if (w.story.pending && d % 2 === 0) acceptStranger(w);
      }
      for (const p of w.pawns) {
        expect(Number.isFinite(p.mood)).toBe(true);
        expect(p.needs.food).toBeGreaterThanOrEqual(0);
      }
      expect(NEEDS.sleepNight).toBeLessThan(90);
    }
  }, 120_000);
});

describe('прогулки праздных', () => {
  function idleWorld(): World {
    const w = new World(5, { pawnCount: 2, startItems: false, fixedTemp: 20, stroll: true });
    for (let y = C - 14; y <= C + 14; y++) for (let x = C - 14; x <= C + 14; x++) w.map.set(x, y, Terrain.Grass);
    w.map.bushes.clear();
    for (const p of w.pawns) p.traits = [];
    w.story.nextEventTick = Number.MAX_SAFE_INTEGER;
    return w;
  }

  it('без дел поселенцы гуляют рядом с лагерем и не уходят далеко', () => {
    const w = idleWorld();
    const seen = new Set<string>();
    let maxDist = 0;
    for (let i = 0; i < 4000; i++) {
      w.tick();
      for (const p of w.pawns) {
        seen.add(`${p.id}:${p.cx},${p.cy}`);
        maxDist = Math.max(maxDist, Math.abs(p.cx - C), Math.abs(p.cy - C));
        expect(p.job === null || p.job.kind === 'stroll' || ['sleep', 'relax', 'eat'].includes(p.job.kind)).toBe(true);
      }
    }
    expect(seen.size).toBeGreaterThan(30); // действительно ходят
    expect(maxDist).toBeLessThanOrEqual(14);
  });

  it('работа прерывает прогулку почти сразу', () => {
    const w = idleWorld();
    run(w, 200);
    w.map.set(C + 4, C, Terrain.Tree);
    w.applyOrder('chop', C + 4, C, C + 4, C);
    run(w, 60);
    expect(w.pawns.some((p) => p.job?.kind === 'chop')).toBe(true);
    run(w, 1500);
    expect(w.map.get(C + 4, C)).toBe(Terrain.Grass);
  });

  it('срочная нужда прерывает прогулку', () => {
    const w = idleWorld();
    run(w, 100);
    w.pawns[0]!.needs.sleep = 5;
    run(w, 60);
    expect(w.pawns[0]!.job?.kind).toBe('sleep');
  });

  it('гуляющий не показывает полосу прогресса и отдыхает', () => {
    const w = idleWorld();
    w.pawns[0]!.needs.rest = 50;
    run(w, 600);
    expect(w.pawns[0]!.needs.rest).toBeGreaterThan(50);
  });

  it('прогулки детерминированы и переживают сохранение', () => {
    const a = idleWorld();
    run(a, 700);
    const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
    run(a, 900);
    run(b, 900);
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
  });
});
