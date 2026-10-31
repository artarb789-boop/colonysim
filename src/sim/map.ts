import {
  BUSH_COUNT,
  BUSH_MAX_BERRIES,
  BUSH_NEAR_START,
  BUSH_REGROW_TICKS,
  MAP_SIZE,
  MOVE_COST,
  START_ZONE_RADIUS,
} from './balance';
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

/** Постройки поверх местности (одна на клетку). Пол хранится отдельным слоем. */
export const Structure = { None: 0, Wall: 1, Door: 2, Bed: 3, Stove: 4 } as const;
export type StructureId = (typeof Structure)[keyof typeof Structure];

export interface Crop {
  /** Тиков роста; созрел при growth >= CROP.growTicks. */
  growth: number;
}

export interface Bush {
  berries: number;
  /** Тиков до появления следующей ягоды. */
  regrow: number;
}

export class GameMap {
  /** Ягодные кусты по индексу клетки (y * width + x). Проходимы. */
  readonly bushes = new Map<number, Bush>();
  /** Посевы на огороде по индексу клетки. */
  readonly crops = new Map<number, Crop>();
  /** Постройки: Structure.* по индексу клетки. */
  readonly structure: Uint8Array;
  /** Пол: 0 — нет, 1 — есть. */
  readonly floor: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly cells: Uint8Array,
  ) {
    this.structure = new Uint8Array(width * height);
    this.floor = new Uint8Array(width * height);
  }

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
    const i = y * this.width + x;
    const base = COST_BY_TERRAIN[this.cells[i]!]!;
    if (base === Infinity) return Infinity;
    switch (this.structure[i]) {
      case Structure.Wall:
      case Structure.Stove:
        return Infinity;
      case Structure.Door:
        return MOVE_COST.door;
      case Structure.Bed:
        return MOVE_COST.bed;
    }
    return this.floor[i] ? Math.min(base, MOVE_COST.floor) : base;
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
  placeBushes(map, seed);
  return map;
}

/** Клетки, достижимые из центра по четырём направлениям. */
function reachableFromCenter(map: GameMap): Uint8Array {
  const w = map.width;
  const seen = new Uint8Array(w * map.height);
  const start = Math.floor(map.height / 2) * w + Math.floor(w / 2);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (map.isPassable(nx, ny) && !seen[ny * w + nx]) {
        seen[ny * w + nx] = 1;
        stack.push(ny * w + nx);
      }
    }
  }
  return seen;
}

/** Часть кустов — рядом со стартом (чтобы игра была играбельной), остальные — где угодно. */
function placeBushes(map: GameMap, seed: number): void {
  const rng = new Rng(seed ^ 0xb055);
  const w = map.width;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(map.height / 2);
  const reach = reachableFromCenter(map);
  const near: number[] = [];
  const far: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < w; x++) {
      if (map.get(x, y) !== Terrain.Grass || !reach[y * w + x]) continue;
      const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      if (d <= START_ZONE_RADIUS) continue;
      (d <= 12 ? near : far).push(y * w + x);
    }
  }
  const shuffle = (a: number[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
  };
  shuffle(near);
  shuffle(far);
  const chosen = [...near.slice(0, BUSH_NEAR_START), ...[...near.slice(BUSH_NEAR_START), ...far].slice(0, BUSH_COUNT - BUSH_NEAR_START)];
  for (const idx of chosen) {
    map.bushes.set(idx, { berries: rng.int(2, BUSH_MAX_BERRIES), regrow: rng.int(1, BUSH_REGROW_TICKS) });
  }
}
