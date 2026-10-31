import { describe, expect, it } from 'vitest';
import { HEALTH, MAP_SIZE } from '../src/sim/balance';
import {
  addWound, bleedRate, consciousness, hasUntreated, isFatal, moveFactor, needsBedrest, pain, partDamage, stepHealth, workFactor,
} from '../src/sim/health';
import { Structure, Terrain } from '../src/sim/map';
import { restoreWorld, serializeWorld } from '../src/sim/serialize';
import { World } from '../src/sim/world';

const C = Math.floor(MAP_SIZE / 2);
const idx = (x: number, y: number) => y * MAP_SIZE + x;

function arena(pawns = 2, ai = true): World {
  const w = new World(5, { pawnCount: pawns, ai, startItems: false, quiet: true, fixedTemp: 20 });
  for (let y = C - 12; y <= C + 12; y++) for (let x = C - 12; x <= C + 12; x++) w.map.set(x, y, Terrain.Grass);
  w.map.bushes.clear();
  for (const p of w.pawns) p.needs = { food: 100, sleep: 100, rest: 100 };
  return w;
}
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) {
    for (const p of w.pawns) if (!p.dead) p.needs.food = Math.max(p.needs.food, 90);
    w.tick();
  }
};

describe('раны и показатели', () => {
  it('рана даёт боль и кровотечение; тупая кровоточит слабее', () => {
    const w = arena(1, false);
    const p = w.pawns[0]!;
    expect(pain(p)).toBe(0);
    addWound(p, 'armL', 'cut', 8);
    const cutBleed = bleedRate(p);
    expect(cutBleed).toBeGreaterThan(0);
    expect(pain(p)).toBeGreaterThan(0);
    const w2 = arena(1, false);
    addWound(w2.pawns[0]!, 'armL', 'blunt', 8);
    expect(bleedRate(w2.pawns[0]!)).toBeLessThan(cutBleed);
  });

  it('раненые ноги замедляют, раненые руки замедляют работу', () => {
    const p = arena(1, false).pawns[0]!;
    expect(moveFactor(p)).toBe(1);
    expect(workFactor(p)).toBe(1);
    addWound(p, 'legL', 'cut', 15);
    expect(moveFactor(p)).toBeLessThan(0.85);
    expect(workFactor(p)).toBeGreaterThan(moveFactor(p));
    addWound(p, 'armR', 'cut', 15);
    expect(workFactor(p)).toBeLessThan(0.85);
    addWound(p, 'legR', 'cut', 25);
    addWound(p, 'legL', 'cut', 25);
    expect(moveFactor(p)).toBeGreaterThanOrEqual(0.15);
  });

  it('сознание падает от боли, потери крови и травмы головы', () => {
    const p = arena(1, false).pawns[0]!;
    expect(consciousness(p)).toBe(100);
    p.blood = 20;
    expect(consciousness(p)).toBeLessThan(50);
    p.blood = 100;
    addWound(p, 'head', 'blunt', 20);
    expect(consciousness(p)).toBeLessThan(60);
  });

  it('голова или торс на пределе — смерть, конечности — нет', () => {
    const p = arena(1, false).pawns[0]!;
    addWound(p, 'legL', 'cut', 60);
    expect(isFatal(p)).toBe(false);
    addWound(p, 'torso', 'cut', HEALTH.partMax.torso);
    expect(isFatal(p)).toBe(true);
  });

  it('неперевязанная рана свёртывается, перевязанная заживает быстрее', () => {
    const a = arena(1, false).pawns[0]!;
    const w1 = addWound(a, 'armL', 'cut', 6);
    const b0 = w1.bleed;
    for (let i = 0; i < 2000; i++) stepHealth(a, 1);
    expect(w1.bleed).toBeLessThan(b0 * 0.5);
    expect(a.blood).toBeLessThan(100);

    const n = arena(1, false).pawns[0]!;
    const t = arena(1, false).pawns[0]!;
    const wn = addWound(n, 'armL', 'cut', 6);
    const wt = addWound(t, 'armL', 'cut', 6);
    wt.treated = true;
    wt.bleed = 0;
    for (let i = 0; i < 1500; i++) {
      stepHealth(n, 1);
      stepHealth(t, 1);
    }
    expect(wt.damage).toBeLessThan(wn.damage);
    expect(t.blood).toBe(100);
  });

  it('кровь восстанавливается, когда кровотечение остановлено', () => {
    const p = arena(1, false).pawns[0]!;
    p.blood = 70;
    for (let i = 0; i < 1000; i++) stepHealth(p, 1);
    expect(p.blood).toBeGreaterThan(75);
  });

  it('постельный режим нужен при серьёзных ранах', () => {
    const p = arena(1, false).pawns[0]!;
    expect(needsBedrest(p)).toBe(false);
    addWound(p, 'armL', 'cut', 2);
    expect(needsBedrest(p)).toBe(false);
    addWound(p, 'legL', 'cut', 8);
    expect(needsBedrest(p)).toBe(true);
  });
});

describe('смерть, падение, похороны', () => {
  it('кровопотеря убивает: труп, журнал, мысль у остальных', () => {
    const w = arena(2, false);
    w.injure(0, 'legL', 'cut', 20);
    w.injure(0, 'legR', 'cut', 20);
    w.injure(0, 'armL', 'cut', 18);
    w.injure(0, 'armR', 'cut', 18);
    run(w, 4000);
    const p = w.pawns[0]!;
    expect(p.dead).toBe(true);
    expect(p.deathTick).toBeGreaterThan(0);
    expect(w.log.some((l) => l.text === 'Погиб — Аня')).toBe(true);
    expect(w.pawns[1]!.thoughts.map((t) => t.id)).toContain('colonistDied');
  });

  it('смертельный удар по голове убивает сразу', () => {
    const w = arena(1, false);
    w.injure(0, 'head', 'blunt', HEALTH.partMax.head);
    expect(w.pawns[0]!.dead).toBe(true);
  });

  it('мёртвый ничего не делает и не занимает кровать; его не лечат', () => {
    const w = arena(2);
    w.map.structure[idx(C + 4, C)] = Structure.Bed;
    w.pawns[0]!.ownedBed = idx(C + 4, C);
    w.injure(0, 'head', 'blunt', HEALTH.partMax.head);
    expect(w.pawns[0]!.ownedBed).toBeNull();
    run(w, 200);
    expect(w.pawns[0]!.job).toBeNull();
    expect(hasUntreated(w.pawns[0]!)).toBe(true); // рана есть, но мёртвого не лечат
    expect(w.pawns[1]!.job?.kind).not.toBe('treat');
    expect(w.living).toHaveLength(1);
    expect(w.lost).toBe(false);
    w.injure(1, 'head', 'blunt', HEALTH.partMax.head);
    expect(w.lost).toBe(true);
  });

  it('упавший без сознания лежит, а потом приходит в себя', () => {
    const w = arena(1, false);
    const p = w.pawns[0]!;
    p.blood = 10; // сознание 25
    addWound(p, 'armL', 'blunt', 3);
    run(w, 5);
    expect(p.downed).toBe(true);
    expect(w.log.some((l) => l.text.includes('без сознания'))).toBe(true);
    p.blood = 100;
    run(w, 10);
    expect(p.downed).toBe(false);
  });

  it('труп портит настроение рядом, похороны (уборка) убирают его', () => {
    const w = arena(2);
    w.injure(0, 'head', 'blunt', HEALTH.partMax.head);
    const corpse = w.pawns[0]!;
    run(w, 60);
    expect(w.pawns[1]!.thoughts.map((t) => t.id)).toContain('sawCorpse');
    run(w, 600);
    expect(corpse.buried).toBe(true);
    expect(w.log.some((l) => l.text === 'Похоронен — Аня')).toBe(true);
  });

  it('без работы «Уборка» не хоронят', () => {
    const w = arena(2);
    w.setPriority(1, 'cleaning', 0);
    w.injure(0, 'head', 'blunt', HEALTH.partMax.head);
    run(w, 800);
    expect(w.pawns[0]!.buried).toBe(false);
  });

  it('странники приходят, пока живых меньше предела, даже если часть погибла', () => {
    const w = arena(3, false);
    w.injure(0, 'head', 'blunt', 99);
    w.injure(1, 'head', 'blunt', 99);
    expect(w.living).toHaveLength(1);
  });
});

describe('лечение', () => {
  it('врач перевязывает раненого: кровь перестаёт идти', () => {
    const w = arena(2);
    w.injure(0, 'legL', 'cut', 10);
    w.injure(0, 'armR', 'cut', 8);
    run(w, 700);
    const p = w.pawns[0]!;
    expect(p.wounds.every((x) => x.treated)).toBe(true);
    expect(bleedRate(p)).toBe(0);
    expect(p.dead).toBe(false);
  });

  it('качество перевязки растёт с навыком медицины', () => {
    const q = (skill: number) => {
      const w = arena(2);
      w.pawns[1]!.skills.medicine = skill;
      w.setPriority(0, 'doctor', 0);
      w.injure(0, 'legL', 'cut', 10);
      run(w, 600);
      return w.pawns[0]!.wounds[0]?.quality ?? 0;
    };
    expect(q(15)).toBeGreaterThan(q(0));
  });

  it('если врач отключён, раненый может перевязать себя; если все отключены — рана остаётся', () => {
    const solo = arena(1);
    solo.injure(0, 'legL', 'cut', 8);
    run(solo, 700);
    expect(solo.pawns[0]!.wounds.every((x) => x.treated)).toBe(true);

    const off = arena(2);
    off.setPriority(0, 'doctor', 0);
    off.setPriority(1, 'doctor', 0);
    off.injure(0, 'legL', 'cut', 8);
    run(off, 500);
    expect(off.pawns[0]!.wounds.some((x) => !x.treated)).toBe(true);
  });

  it('лёжа в кровати раны заживают быстрее, чем на ногах', () => {
    const heal = (bed: boolean) => {
      const w = arena(1);
      if (bed) w.map.structure[idx(C + 3, C)] = Structure.Bed;
      w.injure(0, 'legL', 'cut', 8);
      w.injure(0, 'armL', 'cut', 4);
      run(w, 3000);
      return w.pawns[0]!.wounds.reduce((a, x) => a + x.damage, 0);
    };
    expect(heal(true)).toBeLessThan(heal(false));
  });

  it('тяжело раненый идёт в постель и отдыхает, а не работает', () => {
    const w = arena(1);
    w.map.structure[idx(C + 3, C)] = Structure.Bed;
    w.map.set(C - 3, C, Terrain.Tree);
    w.applyOrder('chop', C - 3, C, C - 3, C);
    w.injure(0, 'legL', 'cut', 9);
    run(w, 500); // сначала перевязывает себя, затем ложится
    const p = w.pawns[0]!;
    expect(p.wounds.every((x) => x.treated)).toBe(true);
    expect(p.job?.kind).toBe('bedrest');
    expect([p.cx, p.cy]).toEqual([C + 3, C]);
    expect(p.ownedBed).toBe(idx(C + 3, C));
  });

  it('спасение: упавшего относят на кровать и закрепляют её', () => {
    const w = arena(2);
    w.map.structure[idx(C + 5, C + 1)] = Structure.Bed;
    const a = w.pawns[0]!;
    a.cx = a.x = a.prevX = C - 3;
    a.cy = a.y = a.prevY = C;
    a.blood = 10;
    addWound(a, 'armL', 'blunt', 3);
    run(w, 5);
    expect(a.downed).toBe(true);
    for (let i = 0; i < 600 && a.carriedBy === null && !(a.cx === C + 5); i++) {
      a.blood = 10;
      w.tick();
    }
    expect(w.pawns[1]!.job?.kind === 'rescue' || a.carriedBy !== null || a.cx === C + 5).toBe(true);
    for (let i = 0; i < 600 && !(a.cx === C + 5 && a.cy === C + 1 && a.carriedBy === null); i++) {
      a.blood = 10;
      w.tick();
    }
    expect([a.cx, a.cy]).toEqual([C + 5, C + 1]);
    expect(a.carriedBy).toBeNull();
    expect(a.ownedBed).toBe(idx(C + 5, C + 1));
  });

  it('несущего прервали — упавшего роняют на месте', () => {
    const w = arena(2);
    w.map.structure[idx(C + 6, C)] = Structure.Bed;
    const a = w.pawns[0]!;
    a.blood = 10;
    addWound(a, 'armL', 'blunt', 3);
    run(w, 5);
    for (let i = 0; i < 300 && a.carriedBy === null; i++) {
      a.blood = 10;
      w.tick();
    }
    expect(a.carriedBy).not.toBeNull();
    w.stopJob(1);
    expect(a.carriedBy).toBeNull();
  });
});

describe('сохранение здоровья', () => {
  it('раны, смерть и спасение переживают сохранение; ход симуляции тот же', () => {
    const a = new World(9);
    a.applyOrder('chop', 10, 10, 50, 50);
    for (let i = 0; i < 600; i++) a.tick();
    a.injure(0, 'legL', 'cut', 12);
    a.injure(1, 'head', 'blunt', 99);
    for (let i = 0; i < 400; i++) a.tick();
    const b = restoreWorld(JSON.parse(JSON.stringify(serializeWorld(a))))!;
    expect(b.pawns[1]!.dead).toBe(true);
    expect(b.pawns[0]!.wounds.length).toBe(a.pawns[0]!.wounds.length);
    for (let i = 0; i < 1500; i++) {
      a.tick();
      b.tick();
    }
    expect(serializeWorld(b)).toEqual(serializeWorld(a));
  });

  it('сохранения версий 3 и ниже (без здоровья) загружаются', () => {
    const w = new World(4);
    for (let i = 0; i < 300; i++) w.tick();
    const s = serializeWorld(w) as unknown as Record<string, unknown> & { pawns: Record<string, unknown>[] };
    s.version = 3;
    for (const p of s.pawns) for (const k of ['wounds', 'blood', 'downed', 'dead', 'deathTick', 'carriedBy', 'buried']) delete p[k];
    const back = restoreWorld(JSON.parse(JSON.stringify(s)))!;
    expect(back).not.toBeNull();
    expect(back.pawns.every((p) => p.wounds.length === 0 && p.blood === 100 && !p.dead)).toBe(true);
    for (let i = 0; i < 300; i++) back.tick();
  });
});

describe('вспомогательное', () => {
  it('partDamage суммирует раны по частям', () => {
    const p = arena(1, false).pawns[0]!;
    addWound(p, 'legL', 'cut', 4);
    addWound(p, 'legL', 'blunt', 3);
    addWound(p, 'armR', 'cut', 2);
    expect(partDamage(p, 'legL')).toBe(7);
    expect(partDamage(p, 'armR')).toBe(2);
    expect(partDamage(p, 'head')).toBe(0);
  });
});
