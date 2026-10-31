import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/sim/map';
import { findPath, pathCost, type Point } from '../src/sim/pathfinding';
import { Rng } from '../src/sim/rng';

/** Эталон: Dijkstra «в лоб» (O(n²)), те же правила ходов. */
function bruteCost(map: GameMap, sx: number, sy: number, tx: number, ty: number): number {
  const w = map.width;
  const dist = new Float64Array(w * map.height).fill(Infinity);
  const done = new Uint8Array(dist.length);
  dist[sy * w + sx] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i]! < Infinity && (best < 0 || dist[i]! < dist[best]!)) best = i;
    if (best < 0) break;
    done[best] = 1;
    const x = best % w;
    const y = (best - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!map.isPassable(nx, ny)) continue;
        if (dx && dy && (!map.isPassable(x + dx, y) || !map.isPassable(x, y + dy))) continue;
        const c = dist[best]! + (dx && dy ? Math.SQRT2 : 1) * map.moveCost(nx, ny);
        if (c < dist[ny * w + nx]!) dist[ny * w + nx] = c;
      }
  }
  return dist[ty * w + tx]!;
}

describe('findPath', () => {
  it('старт == цель → пустой путь', () => {
    const m = GameMap.fromRows(['ddd']);
    expect(findPath(m, 1, 0, 1, 0)).toEqual([]);
  });

  it('прямой путь по земле', () => {
    const m = GameMap.fromRows(['ddddd']);
    const p = findPath(m, 0, 0, 4, 0)!;
    expect(p.map((q) => q.x)).toEqual([1, 2, 3, 4]);
  });

  it('идёт по диагонали, когда это короче', () => {
    const m = GameMap.fromRows(['ddd', 'ddd', 'ddd']);
    expect(findPath(m, 0, 0, 2, 2)!).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });

  it('обходит стену', () => {
    const m = GameMap.fromRows([
      'ddddd',
      'ddsdd',
      'ddsdd',
      'ddddd',
    ]);
    const p = findPath(m, 0, 1, 4, 1)!;
    expect(p).not.toBeNull();
    expect(p.every((q) => m.isPassable(q.x, q.y))).toBe(true);
    expect(p[p.length - 1]).toEqual({ x: 4, y: 1 });
  });

  it('недостижимая цель → null', () => {
    const m = GameMap.fromRows([
      'ddsdd',
      'ddsdd',
      'ddsdd',
    ]);
    expect(findPath(m, 0, 0, 4, 0)).toBeNull();
  });

  it('непроходимая цель и выход за карту → null', () => {
    const m = GameMap.fromRows(['dsd']);
    expect(findPath(m, 0, 0, 1, 0)).toBeNull();
    expect(findPath(m, 0, 0, 5, 0)).toBeNull();
    expect(findPath(m, 0, 0, -1, 0)).toBeNull();
  });

  it('не срезает углы', () => {
    const m = GameMap.fromRows([
      'ds',
      'dd',
    ]);
    // (0,0) → (1,1): диагональ запрещена, так как (1,0) — камень.
    const p = findPath(m, 0, 0, 1, 1)!;
    expect(p).toEqual([{ x: 0, y: 1 }, { x: 1, y: 1 }]);
  });

  it('предпочитает землю траве', () => {
    const m = GameMap.fromRows([
      'ggggg',
      'ddddd',
      'ggggg',
    ]);
    const p = findPath(m, 0, 1, 4, 1)!;
    expect(p.every((q) => q.y === 1)).toBe(true);
  });

  it('оптимален: совпадает с Dijkstra на случайных картах', () => {
    const rng = new Rng(2024);
    const glyphs = 'gggddsw';
    for (let trial = 0; trial < 60; trial++) {
      const rows: string[] = [];
      for (let y = 0; y < 9; y++) {
        let row = '';
        for (let x = 0; x < 9; x++) row += glyphs[rng.int(0, glyphs.length - 1)];
        rows.push(row);
      }
      const m = GameMap.fromRows(rows);
      const sx = rng.int(0, 8), sy = rng.int(0, 8), tx = rng.int(0, 8), ty = rng.int(0, 8);
      const path = findPath(m, sx, sy, tx, ty);
      if (!m.isPassable(sx, sy) || !m.isPassable(tx, ty)) {
        expect(path).toBeNull();
        continue;
      }
      const expected = bruteCost(m, sx, sy, tx, ty);
      if (expected === Infinity) {
        expect(path).toBeNull();
      } else {
        expect(path).not.toBeNull();
        expect(pathCost(m, sx, sy, path as Point[])).toBeCloseTo(expected, 9);
      }
    }
  });
});

import { findPathToAny } from '../src/sim/pathfinding';

describe('findPathToAny', () => {
  it('идёт к ближайшей из целей', () => {
    const m = GameMap.fromRows(['ddddddddd']);
    const p = findPathToAny(m, 4, 0, [{ x: 0, y: 0 }, { x: 6, y: 0 }])!;
    expect(p[p.length - 1]).toEqual({ x: 6, y: 0 });
    expect(p).toHaveLength(2);
  });

  it('старт в цели → пустой путь', () => {
    const m = GameMap.fromRows(['ddd']);
    expect(findPathToAny(m, 1, 0, [{ x: 1, y: 0 }, { x: 2, y: 0 }])).toEqual([]);
  });

  it('недостижимые и непроходимые цели пропускаются', () => {
    const m = GameMap.fromRows(['ddsdd']);
    expect(findPathToAny(m, 0, 0, [{ x: 2, y: 0 }, { x: 4, y: 0 }])).toBeNull();
    expect(findPathToAny(m, 0, 0, [{ x: 2, y: 0 }, { x: 1, y: 0 }])).toEqual([{ x: 1, y: 0 }]);
    expect(findPathToAny(m, 0, 0, [])).toBeNull();
  });
});
