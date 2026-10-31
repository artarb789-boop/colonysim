import { HEALTH } from './balance';
import type { Pawn } from './pawn';

export type BodyPart = 'head' | 'torso' | 'armL' | 'armR' | 'legL' | 'legR';
export const BODY_PARTS: readonly BodyPart[] = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export type WoundKind = 'cut' | 'blunt' | 'pierce';

export interface Wound {
  part: BodyPart;
  kind: WoundKind;
  /** Остаточный урон; рана заживает, когда он падает почти до нуля. */
  damage: number;
  /** Потеря крови за тик (0 после перевязки). */
  bleed: number;
  treated: boolean;
  /** Множитель скорости заживления после перевязки. */
  quality: number;
}

export function partDamage(p: Pawn, part: BodyPart): number {
  let d = 0;
  for (const w of p.wounds) if (w.part === part) d += w.damage;
  return d;
}

export function totalDamage(p: Pawn): number {
  let d = 0;
  for (const w of p.wounds) d += w.damage;
  return d;
}

export function bleedRate(p: Pawn): number {
  let b = 0;
  for (const w of p.wounds) if (!w.treated) b += w.bleed;
  return b;
}

/** Боль 0..100: перевязанные раны болят слабее. */
export function pain(p: Pawn): number {
  let v = 0;
  for (const w of p.wounds) v += w.damage * HEALTH.painPerDamage * (w.treated ? 0.6 : 1) * (w.kind === 'blunt' ? 1.2 : 1);
  return Math.min(100, v);
}

const frac = (p: Pawn, part: BodyPart): number => Math.min(1, partDamage(p, part) / HEALTH.partMax[part]);

/** Множитель скорости ходьбы: ноги и боль. Обе ноги выведены — ползёт. */
export function moveFactor(p: Pawn): number {
  if (p.wounds.length === 0) return 1;
  return Math.max(0.15, 1 - 0.5 * frac(p, 'legL') - 0.5 * frac(p, 'legR') - pain(p) * 0.004);
}

/** Множитель скорости работы: руки и боль. */
export function workFactor(p: Pawn): number {
  if (p.wounds.length === 0) return 1;
  return Math.max(0.2, 1 - 0.5 * frac(p, 'armL') - 0.5 * frac(p, 'armR') - pain(p) * 0.004);
}

/** Сознание 0..100: боль, потеря крови и травма головы. */
export function consciousness(p: Pawn): number {
  const faint = p.blood < HEALTH.bloodFaintBelow ? (HEALTH.bloodFaintBelow - p.blood) * 1.5 : 0;
  return Math.max(0, 100 - pain(p) * 0.6 - faint - frac(p, 'head') * 60);
}

/** Есть рана, которой нужна перевязка. */
export function hasUntreated(p: Pawn): boolean {
  return p.wounds.some((w) => !w.treated && (w.bleed > 0.0005 || w.damage >= 2));
}

/** Самая опасная неперевязанная рана: сначала кровоточащие, затем самые тяжёлые. */
export function worstUntreated(p: Pawn): Wound | null {
  let best: Wound | null = null;
  for (const w of p.wounds) {
    if (w.treated || (w.bleed <= 0.0005 && w.damage < 2)) continue;
    if (!best || w.bleed * 1000 + w.damage > best.bleed * 1000 + best.damage) best = w;
  }
  return best;
}

/** Нужен ли постельный режим: серьёзные раны или кровотечение. */
export function needsBedrest(p: Pawn): boolean {
  return !p.dead && p.wounds.length > 0 && (totalDamage(p) >= HEALTH.bedrestDamage || bleedRate(p) > 0.003);
}

export function addWound(p: Pawn, part: BodyPart, kind: WoundKind, damage: number): Wound {
  const bleedK = kind === 'blunt' ? 0.15 : 1;
  const w: Wound = { part, kind, damage, bleed: damage * HEALTH.bleedPerDamage * bleedK, treated: false, quality: 1 };
  p.wounds.push(w);
  return w;
}

/** Смертельное состояние: кровь, голова или торс. */
export function isFatal(p: Pawn): boolean {
  return p.blood <= 0 || partDamage(p, 'head') >= HEALTH.partMax.head || partDamage(p, 'torso') >= HEALTH.partMax.torso;
}

/** Один тик: кровотечение, заживление, восстановление крови. rest — множитель заживления (1, 1.15, 1.5). */
export function stepHealth(p: Pawn, rest: number): void {
  let bleed = 0;
  for (const w of p.wounds) {
    if (!w.treated) {
      w.bleed *= HEALTH.clot;
      bleed += w.bleed;
    }
    const heal = (w.treated ? HEALTH.healTreated * w.quality : HEALTH.healNatural) * rest;
    w.damage -= heal;
  }
  if (p.wounds.some((w) => w.damage <= 0.25)) p.wounds = p.wounds.filter((w) => w.damage > 0.25);
  if (bleed > 0) p.blood = Math.max(0, p.blood - bleed);
  else if (p.blood < 100) p.blood = Math.min(100, p.blood + HEALTH.bloodRegen);
}
