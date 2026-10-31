import { EXPOSURE, NEEDS } from './balance';
import type { SkillId } from './pawn';
import type { Rng } from './rng';

export type TraitId =
  | 'workaholic' | 'lazy' | 'optimist' | 'pessimist' | 'nightOwl' | 'earlyBird' | 'glutton'
  | 'undemanding' | 'emotional' | 'stoic' | 'hardy' | 'chilly' | 'quick' | 'handy' | 'gardener';

/** Числовые модификаторы черты. Итог для поселенца — сумма/произведение по его чертам. */
export interface Effects {
  /** Множитель скорости любой работы. */
  work: number;
  /** Множитель скорости ходьбы. */
  move: number;
  foodDecay: number;
  sleepDecay: number;
  restDecay: number;
  /** Плоская прибавка к настроению. */
  mood: number;
  /** Множитель значений мыслей (и хороших, и плохих). */
  thoughtScale: number;
  breakBelow: number;
  /** Сдвиг порогов холода и жары, °C. */
  coldShift: number;
  hotShift: number;
  /** При каком уровне сна ночью ложимся спать. */
  nightSleep: number;
  /** Множители мыслей «ел сырое» и «спал на полу». */
  rawScale: number;
  floorScale: number;
  /** Дополнительные множители скорости по навыкам. */
  skill: Partial<Record<SkillId, number>>;
}

export function neutral(): Effects {
  return {
    work: 1, move: 1, foodDecay: 1, sleepDecay: 1, restDecay: 1, mood: 0, thoughtScale: 1,
    breakBelow: 20, coldShift: 0, hotShift: 0, nightSleep: NEEDS.sleepNight,
    rawScale: 1, floorScale: 1, skill: {},
  };
}

interface TraitDef {
  label: string;
  desc: string;
  conflicts: TraitId[];
  apply(e: Effects): void;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  workaholic: {
    label: 'Трудоголик', desc: 'Работает на 15% быстрее, но устаёт на 25% быстрее',
    conflicts: ['lazy'], apply: (e) => { e.work *= 1.15; e.restDecay *= 1.25; },
  },
  lazy: {
    label: 'Лентяй', desc: 'Работает на 15% медленнее, зато почти не устаёт',
    conflicts: ['workaholic'], apply: (e) => { e.work *= 0.85; e.restDecay *= 0.7; },
  },
  optimist: {
    label: 'Оптимист', desc: 'Настроение выше на 6%', conflicts: ['pessimist'], apply: (e) => { e.mood += 6; },
  },
  pessimist: {
    label: 'Пессимист', desc: 'Настроение ниже на 6%', conflicts: ['optimist'], apply: (e) => { e.mood -= 6; },
  },
  nightOwl: {
    label: 'Ночная сова', desc: 'Ночью бодрствует, сон тратится на 10% медленнее',
    conflicts: ['earlyBird'], apply: (e) => { e.nightSleep = 20; e.sleepDecay *= 0.9; },
  },
  earlyBird: {
    label: 'Жаворонок', desc: 'С наступлением ночи ложится рано',
    conflicts: ['nightOwl'], apply: (e) => { e.nightSleep = 75; },
  },
  glutton: {
    label: 'Обжора', desc: 'Голодает на 30% быстрее, сырая еда его огорчает вдвое сильнее',
    conflicts: ['undemanding'], apply: (e) => { e.foodDecay *= 1.3; e.rawScale *= 2; },
  },
  undemanding: {
    label: 'Неприхотливый', desc: 'Не расстраивается из-за сырой еды и сна на полу',
    conflicts: ['glutton'], apply: (e) => { e.rawScale = 0; e.floorScale = 0; },
  },
  emotional: {
    label: 'Эмоциональный', desc: 'Мысли влияют на настроение на 30% сильнее, срыв наступает раньше',
    conflicts: ['stoic'], apply: (e) => { e.thoughtScale *= 1.3; e.breakBelow = 28; },
  },
  stoic: {
    label: 'Стоик', desc: 'Мысли влияют на 30% слабее, срыв наступает позже',
    conflicts: ['emotional'], apply: (e) => { e.thoughtScale *= 0.7; e.breakBelow = 12; },
  },
  hardy: {
    label: 'Закалённый', desc: 'Не страдает от холода и жары',
    conflicts: ['chilly'], apply: (e) => { e.coldShift -= 25; e.hotShift += 12; },
  },
  chilly: {
    label: 'Мерзляк', desc: 'Мёрзнет уже при +6 °C',
    conflicts: ['hardy'], apply: (e) => { e.coldShift += 6; },
  },
  quick: {
    label: 'Быстроногий', desc: 'Ходит на 20% быстрее', conflicts: [], apply: (e) => { e.move *= 1.2; },
  },
  handy: {
    label: 'Рукастый', desc: 'Строит и готовит на 25% быстрее', conflicts: [],
    apply: (e) => { e.skill.construction = (e.skill.construction ?? 1) * 1.25; e.skill.cooking = (e.skill.cooking ?? 1) * 1.25; },
  },
  gardener: {
    label: 'Садовод', desc: 'Растения растут под его руками: работа с ними на 25% быстрее', conflicts: [],
    apply: (e) => { e.skill.plants = (e.skill.plants ?? 1) * 1.25; },
  },
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

const cache = new WeakMap<readonly TraitId[], Effects>();

/** Совокупные эффекты черт поселенца (кэшируются по массиву; результат менять нельзя). */
export function effectsOf(traits: readonly TraitId[]): Effects {
  let e = cache.get(traits);
  if (!e) {
    e = neutral();
    for (const t of traits) TRAITS[t]?.apply(e);
    cache.set(traits, e);
  }
  return e;
}

/** 1–2 несовместимых черты (с шансом 60% на вторую). */
export function pickTraits(rng: Rng): TraitId[] {
  const first = rng.pick(TRAIT_IDS);
  const out: TraitId[] = [first];
  if (rng.next() < 0.6) {
    const rest = TRAIT_IDS.filter((t) => t !== first && !TRAITS[first].conflicts.includes(t));
    out.push(rng.pick(rest));
  }
  return out;
}

/** Порог температуры, ниже которого поселенец мёрзнет / сильно мёрзнет / страдает от жары. */
export function exposureOf(effTemp: number, fx: Effects): 'none' | 'cold' | 'freezing' | 'hot' {
  if (effTemp < EXPOSURE.freezingBelow + fx.coldShift) return 'freezing';
  if (effTemp < EXPOSURE.coldBelow + fx.coldShift) return 'cold';
  if (effTemp > EXPOSURE.hotAbove + fx.hotShift) return 'hot';
  return 'none';
}
