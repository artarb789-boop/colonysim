import { Terrain, type GameMap } from '../sim/map';
import type { BuildKind } from '../sim/build';
import { kindOfStructure } from '../sim/build';
import type { ItemKind } from '../sim/items';
import { hash2 } from '../sim/rng';
import { dirOf, pawnRows, type Dir, type Frame } from './pawnArt';

/** Один «пиксель» арта = SCALE реальных пикселей текстуры; клетка = 16 пикселей арта. */
const SCALE = 3;
const GRID = 16;
export const TILE = GRID * SCALE; // 48

function canvas(w = TILE, h = TILE): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Рисование «пикселями» арта на canvas (с размером пикселя SCALE). */
class Pix {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    private readonly ox = 0,
    private readonly oy = 0,
  ) {}

  px(x: number, y: number, c: string): void {
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + x * SCALE, this.oy + y * SCALE, SCALE, SCALE);
  }

  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
  }

  /** Заливка круга пикселями: центр (cx, cy), радиус r. */
  disc(cx: number, cy: number, r: number, c: string): void {
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) this.px(i, j, c);
  }

  /** Полупрозрачная заливка клетки/области (для теней). */
  shade(x: number, y: number, w: number, h: number, rgba: string): void {
    this.ctx.fillStyle = rgba;
    this.ctx.fillRect(this.ox + x * SCALE, this.oy + y * SCALE, w * SCALE, h * SCALE);
  }
}

// ---------- местность ----------

function hashInt(gx: number, gy: number, salt: number, n: number): number {
  return Math.floor(hash2(gx, gy, salt) * n);
}

/** Низкоконтрастная земля: детали не спорят с фигурками и ресурсами. */
function paintGrass(p: Pix, gx: number, gy: number): void {
  p.rect(0, 0, 16, 16, '#3C5140');
  for (let i = 0; i < 7; i++) {
    const x = hashInt(gx, gy, i * 3 + 1, 15);
    const y = hashInt(gx, gy, i * 3 + 2, 15);
    p.rect(x, y, 2, 1, i % 2 ? '#415744' : '#354A3B');
  }
  const x = 2 + hashInt(gx, gy, 201, 11);
  const y = 3 + hashInt(gx, gy, 202, 11);
  p.px(x, y, '#283D32');
  p.px(x - 1, y - 1, '#627956');
  p.rect(x + 1, y - 2, 1, 2, '#536D4C');
  if (hash2(gx, gy, 200) > 0.86) p.px(x + 3, y + 1, '#A1A478');
}

function paintDirt(p: Pix, gx: number, gy: number): void {
  p.rect(0, 0, 16, 16, '#695842');
  for (let i = 0; i < 9; i++) {
    const x = hashInt(gx, gy, i * 3 + 11, 15);
    const y = hashInt(gx, gy, i * 3 + 12, 16);
    p.rect(x, y, 2, 1, i % 2 ? '#736149' : '#604F3E');
  }
  const x = 2 + hashInt(gx, gy, 211, 11);
  const y = 2 + hashInt(gx, gy, 212, 11);
  p.rect(x, y, 2, 1, '#968875');
  p.rect(x, y + 1, 3, 1, '#51483B');
}

function paintWater(p: Pix, map: GameMap, gx: number, gy: number): void {
  p.rect(0, 0, 16, 16, '#284D5C');
  for (let i = 0; i < 3; i++) {
    const x = hashInt(gx, gy, i * 3 + 21, 10);
    const y = 2 + hashInt(gx, gy, i * 3 + 22, 12);
    p.rect(x, y, 4, 1, '#315E6C');
    p.rect(x + 1, y + 1, 5, 1, '#234551');
    if (i === 0) p.rect(x + 1, y, 2, 1, '#52818A');
  }
  // Мелководье и прерывистый блик только у берега, без сетки внутри озера.
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    if (!map.inBounds(gx + dx, gy + dy) || map.get(gx + dx, gy + dy) === Terrain.Water) continue;
    for (let k = 0; k < 16; k++) {
      const x = dx === 0 ? k : dx < 0 ? 0 : 15;
      const y = dy === 0 ? k : dy < 0 ? 0 : 15;
      p.px(x, y, '#697D70');
      p.px(x - dx, y - dy, '#3F6C72');
      if (k % 5 < 3) p.px(x - dx, y - dy, '#7E9A90');
    }
  }
}

const isStone = (map: GameMap, x: number, y: number): boolean => map.inBounds(x, y) && map.get(x, y) === Terrain.Stone;

/** Камень: гранёные блоки, фаски, выступающий край, тени. Свет сверху-слева. */
function paintStone(p: Pix, map: GameMap, gx: number, gy: number): void {
  const t = Math.round((hash2(gx, gy, 77) - 0.5) * 10);
  const rgb = (d: number) => `rgb(${81 + t + d},${88 + t + d},${87 + t + d})`;
  p.rect(0, 0, 16, 16, rgb(-10));
  // Крупные асимметричные грани вместо повторяющихся кирпичей 4×4.
  p.rect(1, 1, 9, 5, rgb(12));
  p.rect(2, 0, 6, 1, rgb(22));
  p.rect(0, 2, 2, 6, rgb(4));
  p.rect(3, 6, 7, 4, rgb(0));
  p.rect(10, 2, 5, 7, rgb(-2));
  p.rect(11, 3, 4, 1, rgb(10));
  p.rect(1, 11, 8, 3, rgb(6));
  p.rect(2, 10, 5, 1, rgb(17));
  p.rect(10, 10, 5, 4, rgb(-17));
  p.rect(9, 5, 1, 5, rgb(-27));
  p.rect(7, 9, 3, 1, rgb(-27));
  if (hash2(gx, gy, 79) > 0.5) {
    p.rect(4, 2, 1, 2, rgb(-8));
    p.rect(5, 4, 2, 1, rgb(-8));
  }
  // края, обращённые к открытой местности
  if (!isStone(map, gx, gy - 1)) {
    p.rect(0, 0, 16, 2, rgb(34));
    p.rect(0, 2, 16, 1, rgb(18));
  }
  if (!isStone(map, gx - 1, gy)) p.rect(0, 0, 1, 16, rgb(22));
  if (!isStone(map, gx, gy + 1)) {
    p.rect(0, 13, 16, 1, rgb(-22));
    p.rect(0, 14, 16, 2, rgb(-38));
  }
  if (!isStone(map, gx + 1, gy)) {
    p.rect(14, 0, 1, 16, rgb(-18));
    p.rect(15, 0, 1, 16, rgb(-34));
  }
}

/** Тень от камня сверху/слева на соседнюю клетку. */
function paintStoneShadow(p: Pix, map: GameMap, gx: number, gy: number): void {
  if (isStone(map, gx, gy - 1)) {
    p.shade(0, 0, 16, 1, 'rgba(0,0,0,0.42)');
    p.shade(0, 1, 16, 1, 'rgba(0,0,0,0.28)');
    p.shade(0, 2, 16, 1, 'rgba(0,0,0,0.14)');
  }
  if (isStone(map, gx - 1, gy)) {
    p.shade(0, 0, 1, 16, 'rgba(0,0,0,0.32)');
    p.shade(1, 0, 1, 16, 'rgba(0,0,0,0.16)');
  }
}

// ---------- постройки ----------

function buildStructureSprite(kind: BuildKind): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  switch (kind) {
    case 'floor': {
      p.rect(0, 0, 16, 16, '#5C4A36');
      for (let r = 0; r < 4; r++) {
        p.rect(0, r * 4 + 3, 16, 1, '#46372A');
        const off = r % 2 === 0 ? 5 : 11;
        p.rect(off, r * 4, 1, 3, '#46372A');
        for (let i = 0; i < 3; i++) p.px(1 + ((i * 5 + r * 3) % 14), r * 4 + 1, '#6B5742');
      }
      break;
    }
    case 'wall': {
      p.rect(0, 0, 16, 16, '#6B6560');
      for (let r = 0; r < 4; r++) {
        p.rect(0, r * 4 + 3, 16, 1, '#4D4944'); // раствор
        const off = r % 2 === 0 ? 4 : 10;
        p.rect(off, r * 4, 1, 3, '#4D4944');
        p.rect(off + 8 > 15 ? off - 8 : off + 8, r * 4, 1, 3, '#4D4944');
        p.rect(0, r * 4, 16, 1, '#7A746D'); // светлая грань кирпичей
      }
      p.rect(0, 0, 16, 1, '#8A837C');
      p.rect(0, 15, 16, 1, '#3F3B37');
      p.rect(15, 0, 1, 16, '#454140');
      break;
    }
    case 'door': {
      p.rect(0, 0, 16, 16, '#5C4A36');
      p.rect(1, 2, 14, 12, '#4A3320');
      p.rect(2, 3, 12, 10, '#8B6B43');
      for (let i = 0; i < 4; i++) p.rect(2 + i * 3, 3, 1, 10, '#6B4F2E');
      p.rect(2, 7, 12, 1, '#6B4F2E');
      p.px(11, 8, '#E8D9A0');
      p.rect(2, 3, 12, 1, '#A58555');
      break;
    }
    case 'bed': {
      p.rect(2, 1, 12, 14, '#4A3320');
      p.rect(3, 2, 10, 12, '#6E5380');
      p.rect(3, 2, 10, 1, '#8A6CA0');
      p.rect(4, 3, 8, 3, '#E8E6E1');
      p.rect(4, 5, 8, 1, '#C9C6BF');
      p.rect(3, 8, 10, 1, '#58406A');
      p.rect(3, 13, 10, 1, '#58406A');
      break;
    }
    case 'bench': {
      p.rect(1, 5, 14, 9, '#4A3320');
      p.rect(1, 4, 14, 3, '#9A7A4C');
      p.rect(1, 4, 14, 1, '#B89A66');
      p.rect(2, 7, 12, 6, '#7A5A36');
      p.rect(2, 7, 12, 1, '#5E4428');
      p.rect(2, 13, 2, 2, '#3E2A18');
      p.rect(12, 13, 2, 2, '#3E2A18');
      // инструменты на столе: молоток и пила
      p.rect(4, 2, 1, 3, '#A97A4A');
      p.rect(3, 1, 3, 1, '#8D8D93');
      p.rect(8, 3, 5, 1, '#C9C6BF');
      p.px(8, 2, '#8A5A33');
      p.px(9, 2, '#8A5A33');
      break;
    }
    case 'stove': {
      p.rect(1, 1, 14, 14, '#2B2E32');
      p.rect(2, 2, 12, 8, '#50555B');
      p.rect(2, 2, 12, 1, '#6B7178');
      p.disc(5.5, 5.5, 2, '#1E2023');
      p.disc(10.5, 5.5, 2, '#1E2023');
      p.px(5, 5, '#E8A33D');
      p.px(10, 5, '#E8A33D');
      p.rect(3, 11, 10, 3, '#3B3F44');
      p.px(5, 12, '#A3A8AD');
      p.px(8, 12, '#A3A8AD');
      p.px(11, 12, '#A3A8AD');
      break;
    }
  }
  return c;
}

// ---------- объекты и предметы ----------

function buildTree(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  p.shade(3, 13, 11, 2, 'rgba(12,23,21,0.35)');
  p.rect(7, 9, 3, 6, '#493A2C');
  p.rect(7, 10, 1, 4, '#A18150');
  p.rect(6, 14, 5, 1, '#493A2C');
  // Неровная крона из перекрывающихся масс листвы.
  p.rect(4, 1, 7, 2, '#243D32');
  p.rect(2, 3, 11, 6, '#243D32');
  p.rect(1, 5, 14, 3, '#243D32');
  p.rect(3, 9, 10, 2, '#243D32');
  p.rect(5, 11, 6, 1, '#243D32');
  p.rect(4, 2, 6, 3, '#6E8750');
  p.rect(3, 4, 9, 4, '#4E7148');
  p.rect(2, 6, 4, 2, '#62844F');
  p.rect(6, 7, 7, 3, '#36593E');
  p.rect(9, 4, 4, 3, '#426441');
  p.rect(5, 1, 3, 1, '#93A568');
  p.rect(4, 3, 2, 1, '#93A568');
  p.rect(3, 5, 2, 1, '#80995C');
  p.rect(7, 6, 3, 1, '#759051');
  p.rect(5, 8, 2, 1, '#243D32');
  p.px(11, 8, '#65864D');
  return c;
}

function buildBush(): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  p.shade(3, 13, 10, 2, 'rgba(12,23,21,0.3)');
  p.rect(4, 6, 7, 8, '#263F32');
  p.rect(2, 8, 11, 4, '#263F32');
  p.rect(3, 8, 9, 4, '#4E7148');
  p.rect(5, 6, 5, 3, '#66834F');
  p.rect(4, 7, 2, 1, '#8D9F63');
  p.rect(3, 9, 3, 1, '#799355');
  p.rect(8, 11, 4, 2, '#36593E');
  p.px(10, 8, '#8D9F63');
  return c;
}

/** Стадии посева: 0 росток, 1 растёт, 2 созрел. */
function buildCrop(stage: 0 | 1 | 2, herb = false): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  if (herb) {
    // целебная трава: низкий куст, к созреванию — розовые цветки
    p.rect(6, 13, 5, 1, '#3A2D1F');
    const leaves = stage === 0 ? [[8, 11]] : stage === 1 ? [[6, 10], [8, 9], [10, 10], [8, 11]] : [[5, 9], [8, 7], [11, 9], [7, 11], [10, 11]];
    for (const [x, y] of leaves as [number, number][]) {
      p.rect(x, y, 1, 3, '#4F8A44');
      p.px(x - 1, y + 1, '#6BAA5C');
      p.px(x + 1, y, '#6BAA5C');
    }
    if (stage === 2) for (const [x, y] of [[5, 8], [8, 6], [11, 8], [7, 10]] as const) { p.px(x, y, '#F08A7E'); p.px(x + 1, y, '#F6B6AE'); }
    return c;
  }
  if (stage === 0) {
    p.rect(8, 10, 1, 3, '#4F8A44');
    p.px(7, 10, '#6BAA5C');
    p.px(9, 9, '#6BAA5C');
    p.rect(6, 13, 5, 1, '#3A2D1F');
  } else if (stage === 1) {
    for (const x of [5, 8, 11]) {
      p.rect(x, 6, 1, 7, '#5C9A4C');
      p.px(x - 1, 7, '#7BBA66');
      p.px(x + 1, 6, '#7BBA66');
    }
    p.rect(4, 13, 9, 1, '#3A2D1F');
  } else {
    for (const x of [5, 8, 11]) {
      p.rect(x, 5, 1, 8, '#B9A55E');
      p.rect(x - 1, 3, 3, 3, '#E8D9A0');
      p.px(x, 2, '#F3E8B8');
      p.px(x - 1, 4, '#C9B67A');
    }
    p.rect(4, 13, 9, 1, '#3A2D1F');
  }
  return c;
}

function buildItem(kind: ItemKind): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  switch (kind) {
    case 'wood':
      p.rect(2, 9, 11, 4, '#7A4E2A');
      p.rect(2, 9, 11, 1, '#9A6B43');
      p.disc(13, 11, 2, '#C79A62');
      p.disc(13, 11, 1, '#9A6B43');
      p.rect(4, 4, 10, 4, '#8A5A33');
      p.rect(4, 4, 10, 1, '#A97A4A');
      p.disc(4, 6, 2, '#C79A62');
      p.disc(4, 6, 1, '#9A6B43');
      p.rect(5, 8, 9, 1, '#5E3B1E');
      break;
    case 'stone':
      p.disc(7, 10, 4.2, '#5A5A60');
      p.disc(7, 9.5, 3.6, '#8D8D93');
      p.disc(11, 11, 2.8, '#6E6E75');
      p.disc(10.5, 10.5, 2.1, '#8A8A90');
      p.rect(5, 7, 3, 1, '#B9B9C0');
      p.px(4, 8, '#B9B9C0');
      p.rect(8, 13, 4, 1, '#424248');
      break;
    case 'berries':
      for (const [x, y] of [[5, 9], [9, 7], [10, 11], [6, 12]] as const) {
        p.disc(x, y, 1.8, '#9E2F2A');
        p.disc(x, y, 1.2, '#D8524A');
        p.px(x - 1, y - 1, '#F08A7E');
      }
      p.rect(8, 4, 2, 2, '#4F8A44');
      break;
    case 'rice':
      p.disc(8, 11, 5.4, '#B9A55E');
      p.disc(8, 10.5, 4.6, '#E8D9A0');
      for (const [x, y] of [[6, 9], [9, 8], [10, 11], [7, 12], [5, 11]] as const) p.px(x, y, '#F6EFD0');
      p.rect(4, 14, 9, 1, '#6E6240');
      break;
    case 'meal':
      p.disc(8, 10, 6, '#8E8B84');
      p.disc(8, 9.5, 5.4, '#E8E6E1');
      p.disc(8, 9.5, 3.8, '#CFCBC2');
      p.disc(8, 9, 2.6, '#E0A458');
      p.px(7, 8, '#F2C887');
      p.px(9, 10, '#C47F2E');
      p.px(10, 8, '#6BAA5C');
      break;
    case 'club': {
      for (let i = 0; i < 9; i++) {
        p.px(3 + i, 13 - i, '#6B4524');
        p.px(4 + i, 13 - i, '#8A5A33');
        p.px(4 + i, 12 - i, '#A97A4A');
      }
      p.disc(11.5, 4.5, 2.6, '#6B4524');
      p.disc(11.2, 4.2, 2, '#8A5A33');
      p.px(10, 3, '#C79A62');
      p.px(3, 14, '#3E2813');
      break;
    }
    case 'bow': {
      for (const [x, y] of [[11, 2], [12, 3], [12, 4], [13, 5], [13, 6], [13, 7], [13, 8], [13, 9], [13, 10], [12, 11], [12, 12], [11, 13]] as const) {
        p.px(x, y, '#8A5A33');
        p.px(x - 1, y, '#5E3B1E');
      }
      p.rect(10, 3, 1, 10, '#E8E6E1'); // тетива
      p.rect(3, 8, 8, 1, '#A97A4A'); // стрела
      p.px(2, 8, '#C9C6BF');
      p.px(1, 7, '#E8E6E1');
      p.px(1, 9, '#E8E6E1');
      break;
    }
    case 'herb':
      for (const x of [5, 8, 11]) {
        p.rect(x, 6, 1, 8, '#4F8A44');
        p.px(x - 1, 8, '#6BAA5C');
        p.px(x + 1, 7, '#6BAA5C');
        p.px(x, 5, '#F08A7E');
        p.px(x + 1, 5, '#F6B6AE');
      }
      p.rect(4, 13, 9, 1, '#6E6240');
      break;
    case 'medkit':
      p.rect(2, 4, 12, 10, '#9A9AA0');
      p.rect(3, 5, 10, 8, '#E8E6E1');
      p.rect(2, 4, 12, 1, '#C9C6BF');
      p.rect(7, 6, 2, 6, '#D8524A');
      p.rect(5, 8, 6, 2, '#D8524A');
      p.rect(6, 2, 4, 2, '#7C8491');
      break;
    case 'silver':
      p.disc(7, 11, 3.6, '#7C8491');
      p.disc(7, 10, 3.4, '#D5DAE0');
      p.disc(7, 10, 2, '#AEB5C0');
      p.px(6, 9, '#F4F6F8');
      p.disc(11.5, 11.5, 2.6, '#7C8491');
      p.disc(11.5, 10.8, 2.4, '#D5DAE0');
      p.px(11, 10, '#F4F6F8');
      p.disc(8, 6.5, 2.8, '#7C8491');
      p.disc(8, 5.8, 2.6, '#E8ECF0');
      p.px(7, 5, '#FFFFFF');
      break;
  }
  return c;
}

// ---------- поселенцы ----------

const HAIR = ['#3B2A1A', '#C98A3C', '#1E1E22', '#7A3B1E', '#D8D0A0', '#5A3A6A'];
const SKIN = ['#F0C9A0', '#D9A87A', '#B98560', '#8A5E40'];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `rgb(${r},${g},${b})`;
}

function buildPawn(color: string, id: number, dir: Dir, frame: Frame): HTMLCanvasElement {
  const [c, ctx] = canvas();
  const p = new Pix(ctx);
  const pal: Record<string, string> = {
    o: '#20292B',
    H: shade(HAIR[id % HAIR.length]!, 1.4),
    k: shade(SKIN[id % SKIN.length]!, 0.76),
    B: shade(color, 1.2),
    L: '#68747A',
    t: '#70543D',
    h: HAIR[id % HAIR.length]!,
    S: SKIN[id % SKIN.length]!,
    s: SKIN[id % SKIN.length]!,
    e: '#1A1A1E',
    b: color,
    a: shade(color, 0.72),
    l: '#3A4150',
    f: '#2A1F18',
  };
  pawnRows(dir, frame).forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && pal[ch] && p.px(x, y, pal[ch]!)));
  return c;
}

// ---------- публичный интерфейс ----------

const structureCache = new Map<BuildKind, HTMLCanvasElement>();
export function structureSprite(kind: BuildKind): HTMLCanvasElement {
  let s = structureCache.get(kind);
  if (!s) structureCache.set(kind, (s = buildStructureSprite(kind)));
  return s;
}

const itemCache = new Map<ItemKind, HTMLCanvasElement>();
export function itemSprite(kind: ItemKind): HTMLCanvasElement {
  let s = itemCache.get(kind);
  if (!s) itemCache.set(kind, (s = buildItem(kind)));
  return s;
}

let treeSpriteCache: HTMLCanvasElement | null = null;
export const treeSprite = (): HTMLCanvasElement => (treeSpriteCache ??= buildTree());
let bushSpriteCache: HTMLCanvasElement | null = null;
export const bushSprite = (): HTMLCanvasElement => (bushSpriteCache ??= buildBush());
const cropCache: (HTMLCanvasElement | undefined)[] = [];
export function cropSprite(stage: 0 | 1 | 2, herb = false): HTMLCanvasElement {
  const k = stage + (herb ? 3 : 0);
  return (cropCache[k] ??= buildCrop(stage, herb));
}

const pawnCache = new Map<string, HTMLCanvasElement>();
/** Спрайт поселенца по цвету рубашки, номеру (волосы и кожа), направлению взгляда и кадру ходьбы. */
export function pawnSprite(color: string, id: number, facing: number, frame: Frame): HTMLCanvasElement {
  const dir = dirOf(facing);
  const key = `${color}|${id % 24}|${dir}|${frame}`;
  let s = pawnCache.get(key);
  if (!s) pawnCache.set(key, (s = buildPawn(color, id, dir, frame)));
  return s;
}

/** Ягоды на кусте: позиции в сетке 16×16. */
export const BERRY_SPOTS: readonly (readonly [number, number])[] = [[5, 8], [9, 6], [11, 10], [6, 12], [10, 13], [8, 9]];

/** Рисует одну клетку карты в текстуру (координаты клетки gx, gy). */
export function paintCell(ctx: CanvasRenderingContext2D, map: GameMap, gx: number, gy: number): void {
  const ox = gx * TILE;
  const oy = gy * TILE;
  ctx.imageSmoothingEnabled = false;
  const p = new Pix(ctx, ox, oy);
  const t = map.get(gx, gy);
  if (t === Terrain.Stone) {
    paintStone(p, map, gx, gy);
    return;
  }
  if (t === Terrain.Dirt) paintDirt(p, gx, gy);
  else if (t === Terrain.Water) paintWater(p, map, gx, gy);
  else paintGrass(p, gx, gy);
  if (t !== Terrain.Water) paintStoneShadow(p, map, gx, gy);
  if (t === Terrain.Tree) ctx.drawImage(treeSprite(), ox, oy);
  const i = gy * map.width + gx;
  if (map.floor[i]) ctx.drawImage(structureSprite('floor'), ox, oy);
  const built = kindOfStructure(map.structure[i]!);
  if (built) ctx.drawImage(structureSprite(built), ox, oy);
}

