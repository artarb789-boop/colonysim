import type { Camera } from './camera';
import { BUILD, BUSH_MAX_BERRIES, CROP } from '../sim/balance';
import { kindOfStructure, type BuildKind } from '../sim/build';
import type { ItemKind } from '../sim/items';
import { Terrain, type GameMap } from '../sim/map';
import type { Point } from '../sim/pathfinding';
import { jobFraction } from '../sim/jobs';
import { hash2 } from '../sim/rng';
import type { World } from '../sim/world';

const TILE = 32; // размер клетки в офскрин-текстуре

const COLORS = {
  bg: '#14171A',
  grass: '#2F4A2B',
  dirt: '#4A3D2C',
  water: '#1F4E6B',
  stone: '#3A3A3C',
  tree: '#1F3A1D',
  treeHi: '#2A5026',
  wall: '#6B6560',
  floor: '#5C4A36',
  accent: '#E8A33D',
  blueprint: '#5AA9E6',
  good: '#8FBF5A',
  bush: '#3C6B34',
  berry: '#D8524A',
} as const;

const ITEM_COLORS: Record<ItemKind, string> = { wood: '#9A6B43', stone: '#9A9AA0', berries: '#D8524A', rice: '#E8D9A0', meal: '#E0A458', silver: '#D5DAE0' };
export interface View {
  selectedId: number | null;
  /** Область, которую сейчас рисует игрок. */
  preview: { color: string; cells: readonly Point[] } | null;
  /** Подсвечивать замкнутые комнаты. */
  showRooms: boolean;
  /** Затемнение ночью, 0..0.55. */
  darkness: number;
  /** Цвет сезонного оттенка или null. */
  tint: string | null;
}

/** Рисует постройку в квадрате со стороной s (используется и для текстуры, и для «призраков» чертежей). */
function drawStructure(ctx: CanvasRenderingContext2D, kind: BuildKind, x: number, y: number, s: number): void {
  switch (kind) {
    case 'floor':
      ctx.fillStyle = COLORS.floor;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.strokeRect(x + s * 0.04, y + s * 0.04, s * 0.92, s * 0.92);
      return;
    case 'wall':
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(x, y, s, s);
      return;
    case 'door':
      ctx.fillStyle = '#8B6B43';
      ctx.fillRect(x + s * 0.08, y + s * 0.3, s * 0.84, s * 0.4);
      ctx.fillStyle = '#E8D9A0';
      ctx.beginPath();
      ctx.arc(x + s * 0.72, y + s * 0.5, s * 0.05, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'bed':
      ctx.fillStyle = '#6E5380';
      ctx.fillRect(x + s * 0.14, y + s * 0.1, s * 0.72, s * 0.8);
      ctx.fillStyle = '#E8E6E1';
      ctx.fillRect(x + s * 0.2, y + s * 0.15, s * 0.6, s * 0.22);
      return;
    case 'stove':
      ctx.fillStyle = '#3B3F44';
      ctx.fillRect(x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84);
      ctx.fillStyle = '#6B6560';
      for (const [cx, cy] of [[0.32, 0.32], [0.68, 0.32], [0.32, 0.68], [0.68, 0.68]] as const) {
        ctx.beginPath();
        ctx.arc(x + s * cx, y + s * cy, s * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
  }
}

function isStoneAt(map: GameMap, x: number, y: number): boolean {
  return map.inBounds(x, y) && map.get(x, y) === Terrain.Stone;
}

/** Камень с объёмом: фаски, выступающие края и случайные трещины; свет сверху-слева. */
function paintStone(ctx: CanvasRenderingContext2D, map: GameMap, x: number, y: number): void {
  const px = x * TILE;
  const py = y * TILE;
  const h = hash2(x, y, 77);
  const tone = Math.round((h - 0.5) * 16);
  ctx.fillStyle = `rgb(${58 + tone},${58 + tone},${61 + tone})`;
  ctx.fillRect(px, py, TILE, TILE);

  // две крупные грани: светлая сверху-слева, тёмная снизу-справа (разная диагональ у разных клеток)
  const flip = hash2(x, y, 78) > 0.5;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  if (flip) {
    ctx.moveTo(px, py);
    ctx.lineTo(px + TILE, py);
    ctx.lineTo(px, py + TILE);
  } else {
    ctx.moveTo(px, py);
    ctx.lineTo(px + TILE * 0.75, py);
    ctx.lineTo(px, py + TILE * 0.75);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.moveTo(px + TILE, py + TILE);
  ctx.lineTo(px + TILE, py + (flip ? 0 : TILE * 0.25));
  ctx.lineTo(px + (flip ? 0 : TILE * 0.25), py + TILE);
  ctx.closePath();
  ctx.fill();

  // трещины
  if (hash2(x, y, 79) > 0.45) {
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 1.2;
    const x0 = px + TILE * (0.2 + 0.4 * hash2(x, y, 80));
    const y0 = py + TILE * (0.2 + 0.3 * hash2(x, y, 81));
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + TILE * 0.22, y0 + TILE * 0.18);
    ctx.lineTo(x0 + TILE * 0.18, y0 + TILE * 0.4);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(x0 + 1.5, y0 + 1);
    ctx.lineTo(x0 + TILE * 0.22 + 1.5, y0 + TILE * 0.18 + 1);
    ctx.stroke();
  }

  // края, обращённые к открытой местности: светлая фаска сверху/слева, тёмная тень снизу/справа
  const up = !isStoneAt(map, x, y - 1);
  const left = !isStoneAt(map, x - 1, y);
  const down = !isStoneAt(map, x, y + 1);
  const right = !isStoneAt(map, x + 1, y);
  if (up) {
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.fillRect(px, py, TILE, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(px, py + 4, TILE, 3);
  }
  if (left) {
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(px, py, 3, TILE);
  }
  if (down) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(px, py + TILE - 7, TILE, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + TILE - 11, TILE, 4);
  }
  if (right) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(px + TILE - 5, py, 5, TILE);
  }
}

/** Тень, которую соседний камень (сверху или слева) отбрасывает на эту клетку. */
function paintStoneShadow(ctx: CanvasRenderingContext2D, map: GameMap, x: number, y: number): void {
  const px = x * TILE;
  const py = y * TILE;
  if (isStoneAt(map, x, y - 1)) {
    const g = ctx.createLinearGradient(0, py, 0, py + TILE * 0.45);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, TILE, TILE * 0.45);
  }
  if (isStoneAt(map, x - 1, y)) {
    const g = ctx.createLinearGradient(px, 0, px + TILE * 0.35, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, TILE * 0.35, TILE);
  }
}

function paintCell(ctx: CanvasRenderingContext2D, map: GameMap, x: number, y: number): void {
  const t = map.get(x, y);
  const px = x * TILE;
  const py = y * TILE;
  if (t === Terrain.Stone) {
    paintStone(ctx, map, x, y);
    return;
  }
  ctx.fillStyle = t === Terrain.Dirt ? COLORS.dirt : t === Terrain.Water ? COLORS.water : COLORS.grass;
  ctx.fillRect(px, py, TILE, TILE);
  if (t !== Terrain.Water) paintStoneShadow(ctx, map, x, y);
  if (t === Terrain.Tree) {
    ctx.fillStyle = COLORS.tree;
    ctx.beginPath();
    ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.treeHi;
    ctx.beginPath();
    ctx.arc(px + TILE * 0.42, py + TILE * 0.4, TILE * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  const i = y * map.width + x;
  if (map.floor[i]) drawStructure(ctx, 'floor', px, py, TILE);
  const built = kindOfStructure(map.structure[i]!);
  if (built) drawStructure(ctx, built, px, py, TILE);
}

function buildTerrainTexture(map: GameMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * TILE;
  c.height = map.height * TILE;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) paintCell(ctx, map, x, y);
  return c;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private readonly terrainCtx: CanvasRenderingContext2D;
  private viewW = 1;
  private viewH = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: GameMap,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = buildTerrainTexture(map);
    this.terrainCtx = this.terrain.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** alpha ∈ [0,1] — доля прошедшего времени до следующего тика (интерполяция). */
  draw(world: World, cam: Camera, alpha: number, view: View): void {
    const ctx = this.ctx;
    if (world.dirty.length > 0) {
      // перерисовываем и соседей: у камней и теней вид зависит от окружения
      const todo = new Set<number>();
      for (const idx of world.dirty.splice(0)) {
        const x = idx % this.map.width;
        const y = (idx - x) / this.map.width;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if (this.map.inBounds(x + dx, y + dy)) todo.add((y + dy) * this.map.width + x + dx);
      }
      for (const idx of todo) {
        const x = idx % this.map.width;
        paintCell(this.terrainCtx, this.map, x, (idx - x) / this.map.width);
      }
    }
    const dpr = this.canvas.width / this.viewW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const z = cam.zoom;
    const origin = cam.worldToScreen(0, 0);
    const mapPxW = world.map.width * z;
    const mapPxH = world.map.height * z;

    ctx.imageSmoothingEnabled = z < TILE;
    ctx.drawImage(this.terrain, origin.x, origin.y, mapPxW, mapPxH);

    // Сетка при достаточном масштабе — только по видимой части.
    if (z >= 20) {
      const tl = cam.screenToWorld(0, 0);
      const br = cam.screenToWorld(this.viewW, this.viewH);
      const x0 = Math.max(0, Math.floor(tl.x));
      const x1 = Math.min(world.map.width, Math.ceil(br.x));
      const y0 = Math.max(0, Math.floor(tl.y));
      const y1 = Math.min(world.map.height, Math.ceil(br.y));
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round(origin.x + x * z) + 0.5;
        ctx.moveTo(sx, origin.y + y0 * z);
        ctx.lineTo(sx, origin.y + y1 * z);
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round(origin.y + y * z) + 0.5;
        ctx.moveTo(origin.x + x0 * z, sy);
        ctx.lineTo(origin.x + x1 * z, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#2C3238';
    ctx.lineWidth = 2;
    ctx.strokeRect(origin.x, origin.y, mapPxW, mapPxH);

    this.drawOverlays(world, cam, view);
    this.drawBedOwners(world, cam);
    this.drawBushes(world, cam);
    this.drawItems(world, cam);
    this.drawPawns(world, cam, alpha, view);
    if (view.tint) {
      ctx.fillStyle = view.tint;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    if (view.darkness > 0.005) {
      ctx.fillStyle = `rgba(8,14,38,${view.darkness.toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }
    this.drawPreview(cam, view);
  }

  private cellRect(cam: Camera, idx: number): { x: number; y: number; s: number } {
    const w = this.map.width;
    const cx = idx % w;
    const p = cam.worldToScreen(cx, (idx - cx) / w);
    return { x: p.x, y: p.y, s: cam.zoom };
  }

  private visible(r: { x: number; y: number; s: number }): boolean {
    return r.x + r.s >= 0 && r.y + r.s >= 0 && r.x <= this.viewW && r.y <= this.viewH;
  }

  /** Склад, огород, приказы, чертежи и посевы. */
  private drawOverlays(world: World, cam: Camera, _view: View): void {
    const ctx = this.ctx;
    if (_view.showRooms) {
      ctx.fillStyle = 'rgba(90,169,230,0.13)';
      for (const room of world.rooms().rooms) {
        for (const idx of room.cells) {
          const r = this.cellRect(cam, idx);
          if (this.visible(r)) ctx.fillRect(r.x, r.y, r.s, r.s);
        }
      }
    }
    ctx.fillStyle = 'rgba(143,191,90,0.16)';
    for (const idx of world.zone) {
      const r = this.cellRect(cam, idx);
      if (this.visible(r)) ctx.fillRect(r.x, r.y, r.s, r.s);
    }
    ctx.fillStyle = 'rgba(201,180,88,0.18)';
    for (const idx of world.garden) {
      const r = this.cellRect(cam, idx);
      if (this.visible(r)) ctx.fillRect(r.x, r.y, r.s, r.s);
    }

    // посевы
    for (const [idx, c] of world.map.crops) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const f = Math.min(1, c.growth / CROP.growTicks);
      const cx = r.x + r.s / 2;
      const cy = r.y + r.s / 2;
      ctx.fillStyle = f >= 1 ? '#E8D9A0' : '#6FA64A';
      ctx.beginPath();
      ctx.arc(cx, cy, r.s * (0.08 + 0.26 * f), 0, Math.PI * 2);
      ctx.fill();
      if (f >= 1) {
        ctx.strokeStyle = '#B9A55E';
        ctx.lineWidth = Math.max(1, r.s * 0.05);
        ctx.stroke();
      }
    }

    // приказы на деревья, камень, разборку
    ctx.lineWidth = 2;
    for (const [idx, d] of world.designations) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const color = d === 'chop' ? COLORS.blueprint : d === 'mine' ? COLORS.accent : '#F08A7E';
      ctx.fillStyle = d === 'chop' ? 'rgba(90,169,230,0.28)' : d === 'mine' ? 'rgba(232,163,61,0.28)' : 'rgba(240,138,126,0.30)';
      ctx.fillRect(r.x, r.y, r.s, r.s);
      ctx.strokeStyle = color;
      ctx.strokeRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    }

    // чертежи: полупрозрачная постройка, пунктир и полоска прогресса
    for (const [idx, bp] of world.blueprints) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      ctx.globalAlpha = 0.5;
      drawStructure(ctx, bp.kind, r.x, r.y, r.s);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.blueprint;
      ctx.lineWidth = 2;
      ctx.setLineDash([r.s * 0.18, r.s * 0.12]);
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.s - 3, r.s - 3);
      ctx.setLineDash([]);
      const need = BUILD[bp.kind].count;
      const frac = bp.delivered < need ? bp.delivered / need : bp.work;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(r.x + 2, r.y + r.s - 6, r.s - 4, 4);
      ctx.fillStyle = bp.delivered < need ? COLORS.blueprint : COLORS.accent;
      ctx.fillRect(r.x + 2, r.y + r.s - 6, (r.s - 4) * frac, 4);
    }
  }

  /** Метка владельца на закреплённой кровати. */
  private drawBedOwners(world: World, cam: Camera): void {
    const ctx = this.ctx;
    for (const p of world.pawns) {
      if (p.ownedBed === null) continue;
      const r = this.cellRect(cam, p.ownedBed);
      if (!this.visible(r)) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(r.x + r.s * 0.22, r.y + r.s * 0.22, Math.max(2.5, r.s * 0.11), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Гранёный камень: светлая и тёмная грани. */
  private drawRock(cx: number, cy: number, rad: number): void {
    const ctx = this.ctx;
    const pts: [number, number][] = [
      [cx - rad, cy + rad * 0.2], [cx - rad * 0.55, cy - rad * 0.75], [cx + rad * 0.45, cy - rad * 0.9],
      [cx + rad, cy - rad * 0.1], [cx + rad * 0.6, cy + rad * 0.8], [cx - rad * 0.4, cy + rad * 0.9],
    ];
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#8D8D93';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    ctx.lineTo(pts[1]![0], pts[1]![1]);
    ctx.lineTo(pts[2]![0], pts[2]![1]);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.moveTo(pts[3]![0], pts[3]![1]);
    ctx.lineTo(pts[4]![0], pts[4]![1]);
    ctx.lineTo(pts[5]![0], pts[5]![1]);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }

  private drawBushes(world: World, cam: Camera): void {
    const ctx = this.ctx;
    for (const [idx, b] of world.map.bushes) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const cx = r.x + r.s / 2;
      const cy = r.y + r.s / 2;
      ctx.fillStyle = COLORS.bush;
      ctx.beginPath();
      ctx.arc(cx, cy, r.s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.berry;
      const shown = Math.min(b.berries, BUSH_MAX_BERRIES);
      for (let i = 0; i < shown; i++) {
        const a = (i / BUSH_MAX_BERRIES) * Math.PI * 2 + 0.5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r.s * 0.2, cy + Math.sin(a) * r.s * 0.2, Math.max(1.5, r.s * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawItems(world: World, cam: Camera): void {
    const ctx = this.ctx;
    for (const [idx, s] of world.items.stacks) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const pad = r.s * 0.24;
      ctx.fillStyle = ITEM_COLORS[s.kind];
      if (s.kind === 'stone') {
        this.drawRock(r.x + r.s / 2, r.y + r.s / 2, r.s * 0.3);
      } else if (s.kind === 'silver') {
        ctx.beginPath();
        ctx.arc(r.x + r.s / 2, r.y + r.s / 2, r.s * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8E96A3';
        ctx.lineWidth = Math.max(1, r.s * 0.05);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r.x + r.s / 2, r.y + r.s / 2, r.s * 0.13, 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === 'berries' || s.kind === 'meal') {
        ctx.beginPath();
        ctx.arc(r.x + r.s / 2, r.y + r.s / 2, r.s * 0.24, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(r.x + pad, r.y + pad, r.s - pad * 2, r.s - pad * 2);
      }
      if (r.s >= 22) {
        ctx.fillStyle = '#E8E6E1';
        ctx.font = `600 ${Math.round(r.s * 0.34)}px ui-monospace, monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(s.count), r.x + r.s - 2, r.y + r.s - 1);
      }
    }
  }

  private drawPawns(world: World, cam: Camera, alpha: number, view: View): void {
    const ctx = this.ctx;
    const z = cam.zoom;

    // Путь и цель — цвет чертежей/прогресса.
    for (const p of world.pawns) {
      if (view.selectedId !== p.id || p.path.length === 0) continue;
      const px = p.prevX + (p.x - p.prevX) * alpha;
      const py = p.prevY + (p.y - p.prevY) * alpha;
      const ps = cam.worldToScreen(px + 0.5, py + 0.5);
      ctx.strokeStyle = COLORS.blueprint;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(2, z * 0.08);
      ctx.setLineDash([z * 0.2, z * 0.15]);
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      for (const c of p.path) {
        const s = cam.worldToScreen(c.x + 0.5, c.y + 0.5);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (p.target) {
        const t = cam.worldToScreen(p.target.x, p.target.y);
        ctx.strokeStyle = COLORS.blueprint;
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x + 2, t.y + 2, z - 4, z - 4);
      }
    }

    // Поселенцы: цветной круг с инициалом; выбранный — с кольцом.
    const r = z * 0.38;
    for (const p of world.pawns) {
      const px = p.prevX + (p.x - p.prevX) * alpha;
      const py = p.prevY + (p.y - p.prevY) * alpha;
      const ps = cam.worldToScreen(px + 0.5, py + 0.5);
      if (view.selectedId === p.id) {
        ctx.strokeStyle = '#E8E6E1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ps.x, ps.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#14171A';
      ctx.font = `600 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name.charAt(0), ps.x, ps.y + r * 0.06);
      // «нос»: треугольник на краю круга показывает, куда смотрит поселенец
      const fx = Math.cos(p.facing);
      const fy = Math.sin(p.facing);
      const tip = r * 1.5;
      const base = r * 0.92;
      const half = r * 0.38;
      ctx.fillStyle = '#E8E6E1';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ps.x + fx * tip, ps.y + fy * tip);
      ctx.lineTo(ps.x + fx * base - fy * half, ps.y + fy * base + fx * half);
      ctx.lineTo(ps.x + fx * base + fy * half, ps.y + fy * base - fx * half);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const frac = jobFraction(p);
      if (frac !== null) {
        const bw = Math.max(18, z * 0.9);
        const bh = Math.max(3, z * 0.11);
        const bx = ps.x - bw / 2;
        const by = ps.y - r * 1.75 - bh;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = COLORS.blueprint;
        ctx.fillRect(bx, by, bw * frac, bh);
      }
      if (p.carrying) {
        ctx.fillStyle = ITEM_COLORS[p.carrying.kind];
        ctx.fillRect(ps.x + r * 0.5, ps.y - r * 1.1, r * 0.7, r * 0.7);
      }
    }
  }

  private drawPreview(cam: Camera, view: View): void {
    const pr = view.preview;
    if (!pr || pr.cells.length === 0) return;
    const ctx = this.ctx;
    const z = cam.zoom;
    ctx.fillStyle = pr.color;
    ctx.globalAlpha = 0.3;
    for (const c of pr.cells) {
      const p = cam.worldToScreen(c.x, c.y);
      ctx.fillRect(p.x, p.y, z, z);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pr.color;
    ctx.lineWidth = 2;
    for (const c of pr.cells) {
      const p = cam.worldToScreen(c.x, c.y);
      ctx.strokeRect(p.x + 1, p.y + 1, z - 2, z - 2);
    }
  }
}
