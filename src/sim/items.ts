import { DROP_SEARCH_RADIUS, STACK_MAX } from './balance';
import type { GameMap } from './map';

export type ItemKind = 'wood' | 'stone' | 'berries' | 'rice' | 'meal' | 'silver';
export const ITEM_KINDS: readonly ItemKind[] = ['wood', 'stone', 'berries', 'rice', 'meal', 'silver'];

/** Продукты: berries и rice — сырые, meal — готовый обед. */
export type FoodKind = 'berries' | 'rice' | 'meal';
export function isFood(kind: ItemKind): kind is FoodKind {
  return kind === 'berries' || kind === 'rice' || kind === 'meal';
}

export interface ItemStack {
  kind: ItemKind;
  count: number;
}

/** Предметы на земле: не больше одной стопки на клетку. */
export class ItemStore {
  readonly stacks = new Map<number, ItemStack>();

  constructor(private readonly map: GameMap) {}

  /** Сколько предметов вида kind ещё поместится в клетку. */
  roomAt(idx: number, kind: ItemKind): number {
    const s = this.stacks.get(idx);
    if (!s) return STACK_MAX;
    return s.kind === kind ? STACK_MAX - s.count : 0;
  }

  /** Кладёт в клетку, если поместится целиком. */
  put(idx: number, kind: ItemKind, count: number): boolean {
    if (count <= 0 || this.roomAt(idx, kind) < count) return false;
    const s = this.stacks.get(idx);
    if (s) s.count += count;
    else this.stacks.set(idx, { kind, count });
    return true;
  }

  /** Забирает до n предметов; возвращает, сколько забрали. */
  take(idx: number, n: number): number {
    const s = this.stacks.get(idx);
    if (!s) return 0;
    const got = Math.min(n, s.count);
    s.count -= got;
    if (s.count <= 0) this.stacks.delete(idx);
    return got;
  }

  /**
   * Выкладывает предметы около (x, y): сначала в саму клетку, затем по расширяющимся кольцам.
   * Возвращает, сколько не поместилось (в пределах радиуса поиска).
   */
  drop(kind: ItemKind, count: number, x: number, y: number): number {
    let left = count;
    const w = this.map.width;
    for (let r = 0; r <= DROP_SEARCH_RADIUS && left > 0; r++) {
      for (let dy = -r; dy <= r && left > 0; dy++) {
        for (let dx = -r; dx <= r && left > 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = x + dx;
          const cy = y + dy;
          if (!this.map.isPassable(cx, cy)) continue;
          const idx = cy * w + cx;
          const put = Math.min(left, this.roomAt(idx, kind));
          if (put > 0) {
            this.put(idx, kind, put);
            left -= put;
          }
        }
      }
    }
    return left;
  }

  /** Всего предметов вида kind в клетках, удовлетворяющих условию. */
  total(kind: ItemKind, filter?: (idx: number) => boolean): number {
    let sum = 0;
    for (const [idx, s] of this.stacks) if (s.kind === kind && (!filter || filter(idx))) sum += s.count;
    return sum;
  }
}
