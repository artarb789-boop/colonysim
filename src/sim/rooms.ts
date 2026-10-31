import { ROOM_MAX_CELLS } from './balance';
import { Structure, Terrain, type GameMap } from './map';

export interface Room {
  id: number;
  cells: number[];
  /** Индексы клеток с кроватями внутри. */
  beds: number[];
  stoves: number[];
}

export interface RoomMap {
  /** Номер комнаты для каждой клетки; -1 — улица или стена. */
  roomOf: Int32Array;
  rooms: Room[];
}

/** Клетки, из которых состоит «пространство» комнаты: всё, кроме стен, дверей и скал. */
function isSpace(map: GameMap, i: number): boolean {
  if (map.cells[i] === Terrain.Stone) return false;
  const s = map.structure[i];
  return s !== Structure.Wall && s !== Structure.Door;
}

/**
 * Комнаты — замкнутые заливкой области, ограниченные стенами, дверьми и скалами.
 * Область, дотянувшаяся до края карты или слишком большая, считается улицей.
 */
export function computeRooms(map: GameMap): RoomMap {
  const w = map.width;
  const h = map.height;
  const roomOf = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  const rooms: Room[] = [];

  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !isSpace(map, start)) continue;
    const cells: number[] = [];
    let outside = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      cells.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) outside = true;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }
    function push(j: number): void {
      if (!seen[j] && isSpace(map, j)) {
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (outside || cells.length > ROOM_MAX_CELLS) continue;
    const room: Room = { id: rooms.length, cells, beds: [], stoves: [] };
    for (const i of cells) {
      roomOf[i] = room.id;
      if (map.structure[i] === Structure.Bed) room.beds.push(i);
      else if (map.structure[i] === Structure.Stove) room.stoves.push(i);
    }
    rooms.push(room);
  }
  return { roomOf, rooms };
}
