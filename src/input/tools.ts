import { isBuildKind, type BuildKind } from '../sim/build';
import type { Order } from '../sim/world';

/** Инструмент, который игрок выбрал в панелях «Приказы» и «Строить». */
export type Tool = Order | BuildKind;

export function isBuildTool(t: Tool): t is BuildKind {
  return isBuildKind(t);
}

export const TOOL_COLORS: Record<Tool, string> = {
  chop: '#5AA9E6',
  mine: '#E8A33D',
  zone: '#8FBF5A',
  garden: '#C9B458',
  herbs: '#6EC896',
  deconstruct: '#F08A7E',
  erase: '#F08A7E',
  wall: '#5AA9E6',
  door: '#5AA9E6',
  floor: '#5AA9E6',
  bed: '#5AA9E6',
  stove: '#5AA9E6',
  bench: '#5AA9E6',
};
