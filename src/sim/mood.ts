import { MOOD, STATE_MOODS, THOUGHTS, NEEDS } from './balance';
import type { Pawn } from './pawn';

export type ThoughtId = keyof typeof THOUGHTS;
export type StateId = keyof typeof STATE_MOODS;
export type MoodKey = ThoughtId | StateId;

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

/** Все слагаемые настроения: активные мысли-события и мысли-состояния по нуждам. */
export function moodEntries(pawn: Pawn, tick: number): MoodEntry[] {
  const out: MoodEntry[] = [];
  for (const t of pawn.thoughts) if (t.until > tick) out.push({ key: t.id, value: THOUGHTS[t.id].value });
  const n = pawn.needs;
  if (n.food <= 0) out.push({ key: 'starving', value: STATE_MOODS.starving });
  else if (n.food < NEEDS.foodUrgent) out.push({ key: 'hungry', value: STATE_MOODS.hungry });
  if (n.sleep < NEEDS.sleepUrgent) out.push({ key: 'tired', value: STATE_MOODS.tired });
  if (n.rest < NEEDS.restUrgent) out.push({ key: 'exhausted', value: STATE_MOODS.exhausted });
  return out;
}

export function computeMood(pawn: Pawn, tick: number): number {
  let m: number = MOOD.base;
  for (const e of moodEntries(pawn, tick)) m += e.value;
  return Math.max(0, Math.min(100, m));
}
