import { MAP_SIZE, MOVE_COST, START_ZONE_RADIUS } from './balance';
import { Rng, hash2 } from './rng';

export const Terrain = { Grass: 0, Dirt: 1, Stone: 2, Water: 3, Tree: 4 } as const;
export type TerrainId = (typeof Terrain)[keyof typeof Terrain];

const COST_BY_TERRAIN: readonly number[] = [
  MOVE_COST.grass,
  MOVE_COST.dirt,
  MOVE_COST.stone,
  MOVE_COST.water,
  MOVE_COST.tree,
];

export class GameMap {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly cells: Uint8Array,
  ) {}

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): TerrainId {
    return this.cells[y * this.width + x]! as TerrainId;
  }

  set(x: number, y: number, t: TerrainId): void {
    this.cells[y * this.width + x] = t;
  }

  /** Стоимость прохода по клетке; Infinity — нельзя (или вне карты). */
  moveCost(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Infinity;
    return COST_BY_TERRAIN[this.get(x, y)]!;
  }

  isPassable(x: number, y: number): boolean {
    return this.moveCost(x, y) !== Infinity;
  }

  /** Карта из строк: g=трава, d=земля, s=камень, w=вода, t=дерево. Для тестов. */
  static fromRows(rows: readonly string[]): GameMap {
    const h = rows.length;
    const w = rows[0]!.length;
    const map = new GameMap(w, h, new Uint8Array(w * h));
    const ids: Record<string, TerrainId> = {
      g: Terrain.Grass,
      d: Terrain.Dirt,
      s: Terrain.Stone,
      w: Terrain.Water,
      t: Terrain.Tree,
    };
    rows.forEach((row, y) => {
      for (let x = 0; x < w; x++) map.set(x, y, ids[row[x]!] ?? Terrain.Grass);
    });
    return map;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Фрактальный шум, нормированный в [0, 1]. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 131) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Доли местности. Пороги берутся по процентилям шума, поэтому доли стабильны для любого сида. */
export const GEN = {
  stoneShare: 0.12,
  waterShare: 0.12,
  dirtShare: 0.2,
  treeDense: 0.3,
  treeSparse: 0.03,
} as const;

/** Значение, ниже которого лежит доля `share` элементов. */
function quantile(values: Float64Array, share: number): number {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
}

export function generateMap(seed: number, width = MAP_SIZE, height = MAP_SIZE): GameMap {
  const n = width * height;
  const map = new GameMap(width, height, new Uint8Array(n));
  const elevation = new Float64Array(n);
  const wetness = new Float64Array(n);
  const soil = new Float64Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      elevation[i] = fbm(x / 11, y / 11, seed);
      wetness[i] = fbm(x / 9, y / 9, seed + 1000);
      soil[i] = fbm(x / 6, y / 6, seed + 2000);
    }
  }
  const stoneAbove = quantile(elevation, 1 - GEN.stoneShare);
  const waterBelow = quantile(wetness, GEN.waterShare);
  const dirtAbove = quantile(soil, 1 - GEN.dirtShare);

  const rng = new Rng(seed ^ 0x5eed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const roll = rng.next(); // один бросок на клетку — порядок стабилен
      const forest = fbm(x / 8, y / 8, seed + 3000);
      let t: TerrainId = Terrain.Grass;
      if (elevation[i]! >= stoneAbove) t = Terrain.Stone;
      else if (wetness[i]! <= waterBelow) t = Terrain.Water;
      else if (soil[i]! >= dirtAbove) t = Terrain.Dirt;
      else if (roll < (forest > 0.5 ? GEN.treeDense : GEN.treeSparse)) t = Terrain.Tree;
      map.set(x, y, t);
    }
  }
  // Стартовая зона в центре: чистая трава.
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  for (let dy = -START_ZONE_RADIUS; dy <= START_ZONE_RADIUS; dy++) {
    for (let dx = -START_ZONE_RADIUS; dx <= START_ZONE_RADIUS; dx++) {
      map.set(cx + dx, cy + dy, Terrain.Grass);
    }
  }
  return map;
}
