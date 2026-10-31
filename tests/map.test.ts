import { describe, expect, it } from 'vitest';
import { MAP_SIZE, START_ZONE_RADIUS } from '../src/sim/balance';
import { GameMap, Terrain, generateMap } from '../src/sim/map';

describe('generateMap', () => {
  it('детерминирован по сиду', () => {
    expect(generateMap(42).cells).toEqual(generateMap(42).cells);
  });

  it('разные сиды дают разные карты', () => {
    expect(generateMap(1).cells).not.toEqual(generateMap(2).cells);
  });

  it('размер 60×60', () => {
    const m = generateMap(1);
    expect(m.width).toBe(MAP_SIZE);
    expect(m.height).toBe(MAP_SIZE);
    expect(m.cells.length).toBe(MAP_SIZE * MAP_SIZE);
  });

  it('стартовая зона в центре проходима', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const m = generateMap(seed);
      const c = Math.floor(MAP_SIZE / 2);
      for (let dy = -START_ZONE_RADIUS; dy <= START_ZONE_RADIUS; dy++)
        for (let dx = -START_ZONE_RADIUS; dx <= START_ZONE_RADIUS; dx++)
          expect(m.isPassable(c + dx, c + dy)).toBe(true);
    }
  });

  it('доли местности разумные, а большая часть проходимого достижима из центра', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = generateMap(seed);
      const count = [0, 0, 0, 0, 0];
      m.cells.forEach((v) => count[v]!++);
      const total = m.cells.length;
      expect(count[Terrain.Stone]! / total).toBeGreaterThan(0.05);
      expect(count[Terrain.Stone]! / total).toBeLessThan(0.25);
      expect(count[Terrain.Water]! / total).toBeGreaterThan(0.05);
      expect(count[Terrain.Water]! / total).toBeLessThan(0.25);
      expect(count[Terrain.Tree]! / total).toBeGreaterThan(0.03);
      expect(count[Terrain.Grass]! / total).toBeGreaterThan(0.3);

      const seen = new Uint8Array(total);
      const stack = [Math.floor(MAP_SIZE / 2) * MAP_SIZE + Math.floor(MAP_SIZE / 2)];
      seen[stack[0]!] = 1;
      let reach = 0;
      while (stack.length) {
        const i = stack.pop()!;
        reach++;
        const x = i % MAP_SIZE;
        const y = (i - x) / MAP_SIZE;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (m.isPassable(nx, ny) && !seen[ny * MAP_SIZE + nx]) {
            seen[ny * MAP_SIZE + nx] = 1;
            stack.push(ny * MAP_SIZE + nx);
          }
        }
      }
      let passable = 0;
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.isPassable(x, y)) passable++;
      expect(reach / passable).toBeGreaterThan(0.7);
    }
  });
});

describe('GameMap', () => {
  it('проходимость и стоимость', () => {
    const m = GameMap.fromRows(['gdswt']);
    expect(m.isPassable(0, 0)).toBe(true); // трава
    expect(m.isPassable(1, 0)).toBe(true); // земля
    expect(m.isPassable(2, 0)).toBe(false); // камень
    expect(m.isPassable(3, 0)).toBe(false); // вода
    expect(m.isPassable(4, 0)).toBe(false); // дерево
    expect(m.moveCost(0, 0)).toBeGreaterThan(m.moveCost(1, 0)); // по траве медленнее
  });

  it('вне карты непроходимо', () => {
    const m = GameMap.fromRows(['gg']);
    expect(m.isPassable(-1, 0)).toBe(false);
    expect(m.isPassable(0, 1)).toBe(false);
  });
});
