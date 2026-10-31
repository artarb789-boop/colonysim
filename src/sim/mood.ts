import { MOOD, STATE_MOODS, THOUGHTS, NEEDS } from './balance';
import { isSick, type Pawn } from './pawn';
import { effectsOf } from './traits';

export type ThoughtId = keyof typeof THOUGHTS;
export type StateId = keyof typeof STATE_MOODS;
export type MoodKey = ThoughtId | StateId | 'optimist' | 'pessimist';

/** Мысль-событие: действует до тика until. Одна мысль каждого вида; повтор продлевает её. */
export interface Thought {
  id: ThoughtId;
  until: number;
}

export function addThought(pawn: Pawn, id: ThoughtId, tick: number): void {
  const until = tick + THOUGHTS[id].ticks;
  const existing = pawn.thoughts.find((t) => t.id === id);
  if (existing) existing.until = until;
  else pawn.thoughts.push({ id, until });
}

export function pruneThoughts(pawn: Pawn, tick: number): void {
  pawn.thoughts = pawn.thoughts.filter((t) => t.until > tick);
}

export interface MoodEntry {
  key: MoodKey;
  value: number;
}

/** Все слагаемые настроения: активные мысли-события и мысли-состояния по нуждам (с учётом черт). */
export function moodEntries(pawn: Pawn, tick: number): MoodEntry[] {
  const fx = effectsOf(pawn.traits);
  const out: MoodEntry[] = [];
  for (const t of pawn.thoughts) {
    if (t.until <= tick) continue;
    let v: number = THOUGHTS[t.id].value;
    if (t.id === 'ateRaw') v *= fx.rawScale;
    else if (t.id === 'sleptOnFloor') v *= fx.floorScale;
    v = Math.round(v * fx.thoughtScale);
    if (v !== 0) out.push({ key: t.id, value: v });
  }
  const n = pawn.needs;
  const state = (key: StateId) => out.push({ key, value: Math.round(STATE_MOODS[key] * fx.thoughtScale) });
  if (n.food <= 0) state('starving');
  else if (n.food < NEEDS.foodUrgent) state('hungry');
  if (n.sleep < NEEDS.sleepUrgent) state('tired');
  if (n.rest < NEEDS.restUrgent) state('exhausted');
  if (pawn.exposure !== 'none') state(pawn.exposure);
  if (isSick(pawn, tick)) state('sick');
  if (fx.mood !== 0) out.push({ key: fx.mood > 0 ? 'optimist' : 'pessimist', value: fx.mood });
  return out;
}

export function computeMood(pawn: Pawn, tick: number): number {
  let m: number = MOOD.base;
  for (const e of moodEntries(pawn, tick)) m += e.value;
  return Math.max(0, Math.min(100, m));
}
