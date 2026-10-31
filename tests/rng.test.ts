import { describe, expect, it } from 'vitest';
import { Rng, hash2 } from '../src/sim/rng';

describe('Rng', () => {
  it('один сид — одна последовательность', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('разные сиды дают разные последовательности', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('значения в [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int включает обе границы и не выходит за них', () => {
    const r = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('состояние можно сохранить и восстановить', () => {
    const r = new Rng(9);
    r.next();
    const saved = r.getState();
    const x = r.next();
    r.setState(saved);
    expect(r.next()).toBe(x);
  });

  it('hash2 детерминирован и в [0, 1)', () => {
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    const v = hash2(-10, 99, 1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});
