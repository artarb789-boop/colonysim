import type { GameMap } from './map';

export interface Point {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Минимальная стоимость клетки в игре — нужна для допустимой эвристики. */
const MIN_COST = 1;

/** Бинарная куча (min-heap) по ключу f с ленивым удалением. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0]!;
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= lastKey) break;
        keys[i] = keys[c]!;
        vals[i] = vals[c]!;
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}

function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return (ax + ay + (SQRT2 - 2) * Math.min(ax, ay)) * MIN_COST;
}

/** Стоимость одного шага: длина шага × стоимость клетки, в которую входим. */
export function stepCost(map: GameMap, dx: number, dy: number, tx: number, ty: number): number {
  return (dx !== 0 && dy !== 0 ? SQRT2 : 1) * map.moveCost(tx, ty);
}

/**
 * A* по сетке, 8 направлений, без срезания углов.
 * Возвращает клетки пути БЕЗ стартовой (пустой массив, если старт == цель),
 * либо null, если цель непроходима или недостижима.
 */
export function findPath(map: GameMap, sx: number, sy: number, tx: number, ty: number): Point[] | null {
  if (!map.isPassable(sx, sy) || !map.isPassable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];

  const w = map.width;
  const n = w * map.height;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();

  const start = sy * w + sx;
  const goal = ty * w + tx;
  g[start] = 0;
  open.push(octile(tx - sx, ty - sy), start);

  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;

    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!map.isPassable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!map.isPassable(cx + dx, cy) || !map.isPassable(cx, cy + dy))) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur]! + stepCost(map, dx, dy, nx, ny);
      if (ng < g[ni]!) {
        g[ni] = ng;
        parent[ni] = cur;
        open.push(ng + octile(tx - nx, ty - ny), ni);
      }
    }
  }

  if (parent[goal] === -1) return null;
  const path: Point[] = [];
  for (let i = goal; i !== start; i = parent[i]!) path.push({ x: i % w, y: (i - (i % w)) / w });
  return path.reverse();
}

/** Полная стоимость пути из (sx, sy). Для тестов и отладки. */
export function pathCost(map: GameMap, sx: number, sy: number, path: readonly Point[]): number {
  let cost = 0;
  let x = sx;
  let y = sy;
  for (const p of path) {
    cost += stepCost(map, p.x - x, p.y - y, p.x, p.y);
    x = p.x;
    y = p.y;
  }
  return cost;
}
