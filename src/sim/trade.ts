import { PRICES, TRADE } from './balance';
import type { ItemKind } from './items';
import type { World } from './world';

export type Good = keyof typeof PRICES;
export const GOODS: readonly Good[] = ['wood', 'stone', 'berries', 'rice', 'meal'];

/** Сколько серебра получим, продав qty штук. */
export function sellPrice(kind: Good, qty: number): number {
  return Math.floor(PRICES[kind] * TRADE.sellFactor * qty);
}

/** Сколько серебра отдадим, купив qty штук. */
export function buyPrice(kind: Good, qty: number): number {
  return Math.ceil(PRICES[kind] * TRADE.buyFactor * qty);
}

/** Сколько ещё поместится на склад-зону. */
function zoneRoom(world: World, kind: ItemKind): number {
  let room = 0;
  for (const idx of world.zone) room += world.items.roomAt(idx, kind);
  return room;
}

function takeFromZone(world: World, kind: ItemKind, qty: number): void {
  let left = qty;
  for (const idx of world.zone) {
    if (left <= 0) break;
    const s = world.items.stacks.get(idx);
    if (s && s.kind === kind) left -= world.items.take(idx, left);
  }
}

function putInZone(world: World, kind: ItemKind, qty: number): void {
  let left = qty;
  for (const idx of world.zone) {
    if (left <= 0) break;
    const put = Math.min(left, world.items.roomAt(idx, kind));
    if (put > 0 && world.items.put(idx, kind, put)) left -= put;
  }
}

export function canSell(world: World, kind: Good, qty: number): boolean {
  const gain = sellPrice(kind, qty);
  return world.traderPresent && gain > 0 && world.stockpile()[kind] >= qty && zoneRoom(world, 'silver') + qty >= gain;
}

export function canBuy(world: World, kind: Good, qty: number): boolean {
  return world.traderPresent && world.stockpile().silver >= buyPrice(kind, qty) && zoneRoom(world, kind) >= qty;
}

/** Продать qty штук со склада за серебро. */
export function sell(world: World, kind: Good, qty: number): boolean {
  if (!canSell(world, kind, qty)) return false;
  const gain = sellPrice(kind, qty);
  takeFromZone(world, kind, qty);
  putInZone(world, 'silver', gain);
  return true;
}

/** Купить qty штук за серебро со склада. */
export function buy(world: World, kind: Good, qty: number): boolean {
  if (!canBuy(world, kind, qty)) return false;
  takeFromZone(world, 'silver', buyPrice(kind, qty));
  putInZone(world, kind, qty);
  return true;
}
