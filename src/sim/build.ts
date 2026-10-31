import { BUILD } from './balance';
import type { ItemKind } from './items';
import { Structure, type StructureId } from './map';
import type { Point } from './pathfinding';

export type BuildKind = keyof typeof BUILD;
export const BUILD_KINDS = Object.keys(BUILD) as BuildKind[];

export function isBuildKind(x: string): x is BuildKind {
  return Object.prototype.hasOwnProperty.call(BUILD, x);
}

export interface Blueprint {
  kind: BuildKind;
  /** Сколько материала уже подвезено. */
  delivered: number;
  /** Прогресс постройки 0..1. */
  work: number;
}

export function costOf(kind: BuildKind): { item: ItemKind; count: number } {
  return { item: BUILD[kind].item, count: BUILD[kind].count };
}

export const STRUCTURE_OF: Record<Exclude<BuildKind, 'floor'>, StructureId> = {
  wall: Structure.Wall,
  door: Structure.Door,
  bed: Structure.Bed,
  stove: Structure.Stove,
  bench: Structure.Bench,
};

/** Перекрывает ли готовая постройка проход. */
export function blocksMovement(kind: BuildKind): boolean {
  return kind === 'wall' || kind === 'stove' || kind === 'bench';
}

/** Вид постройки по коду структуры (для разборки). */
export function kindOfStructure(id: number): Exclude<BuildKind, 'floor'> | null {
  switch (id) {
    case Structure.Wall: return 'wall';
    case Structure.Door: return 'door';
    case Structure.Bed: return 'bed';
    case Structure.Stove: return 'stove';
    case Structure.Bench: return 'bench';
    default: return null;
  }
}

export type Shape = 'line' | 'rect';

/** Стены рисуются линией, всё остальное — прямоугольником. */
export function shapeOf(kind: BuildKind): Shape {
  return kind === 'wall' ? 'line' : 'rect';
}

/** Клетки области. Линия «прилипает» к оси с большим смещением. */
export function cellsOf(shape: Shape, x0: number, y0: number, x1: number, y1: number): Point[] {
  const out: Point[] = [];
  if (shape === 'line') {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const step = dx >= 0 ? 1 : -1;
      for (let x = x0; x !== x1 + step; x += step) out.push({ x, y: y0 });
    } else {
      const step = dy >= 0 ? 1 : -1;
      for (let y = y0; y !== y1 + step; y += step) out.push({ x: x0, y });
    }
    return out;
  }
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) out.push({ x, y });
  }
  return out;
}
