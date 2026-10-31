import type { Camera } from './camera';
import { BUSH_MAX_BERRIES } from '../sim/balance';
import type { ItemKind } from '../sim/items';
import { Terrain, type GameMap } from '../sim/map';
import type { Order, World } from '../sim/world';

const TILE = 32; // размер клетки в офскрин-текстуре

const COLORS = {
  bg: '#14171A',
  grass: '#2F4A2B',
  dirt: '#4A3D2C',
  water: '#1F4E6B',
  stone: '#3A3A3C',
  tree: '#1F3A1D',
  treeHi: '#2A5026',
  accent: '#E8A33D',
  blueprint: '#5AA9E6',
  good: '#8FBF5A',
  bush: '#3C6B34',
  berry: '#D8524A',
} as const;

const ITEM_COLORS: Record<ItemKind, string> = { wood: '#9A6B43', stone: '#9A9AA0', berries: '#D8524A' };
const ORDER_COLORS: Record<Order, string> = {
  chop: COLORS.blueprint,
  mine: COLORS.accent,
  zone: COLORS.good,
  erase: '#F08A7E',
};

export interface DrawRect {
  order: Order;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface View {
  selectedId: number | null;
  /** Область, которую сейчас рисует игрок (клетки, границы включительно). */
  preview: DrawRect | null;
}

function paintCell(ctx: CanvasRenderingContext2D, map: GameMap, x: number, y: number): void {
  const t = map.get(x, y);
  const px = x * TILE;
  const py = y * TILE;
  ctx.fillStyle =
    t === Terrain.Dirt ? COLORS.dirt : t === Terrain.Stone ? COLORS.stone : t === Terrain.Water ? COLORS.water : COLORS.grass;
  ctx.fillRect(px, py, TILE, TILE);
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
    for (const idx of world.dirty.splice(0)) {
      const x = idx % this.map.width;
      paintCell(this.terrainCtx, this.map, x, (idx - x) / this.map.width);
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
    this.drawBushes(world, cam);
    this.drawItems(world, cam);
    this.drawPawns(world, cam, alpha, view);
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

  /** Склад-зона и приказы на деревья/камень. */
  private drawOverlays(world: World, cam: Camera, _view: View): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(143,191,90,0.16)';
    for (const idx of world.zone) {
      const r = this.cellRect(cam, idx);
      if (this.visible(r)) ctx.fillRect(r.x, r.y, r.s, r.s);
    }
    ctx.lineWidth = 2;
    for (const [idx, d] of world.designations) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const color = d === 'chop' ? COLORS.blueprint : COLORS.accent;
      ctx.fillStyle = d === 'chop' ? 'rgba(90,169,230,0.28)' : 'rgba(232,163,61,0.28)';
      ctx.fillRect(r.x, r.y, r.s, r.s);
      ctx.strokeStyle = color;
      ctx.strokeRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    }
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
      if (s.kind === 'berries') {
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
      if (p.carrying) {
        ctx.fillStyle = ITEM_COLORS[p.carrying.kind];
        ctx.fillRect(ps.x + r * 0.5, ps.y - r * 1.1, r * 0.7, r * 0.7);
      }
    }
  }

  private drawPreview(cam: Camera, view: View): void {
    const pr = view.preview;
    if (!pr) return;
    const ctx = this.ctx;
    const x0 = Math.min(pr.x0, pr.x1);
    const y0 = Math.min(pr.y0, pr.y1);
    const x1 = Math.max(pr.x0, pr.x1) + 1;
    const y1 = Math.max(pr.y0, pr.y1) + 1;
    const a = cam.worldToScreen(x0, y0);
    const b = cam.worldToScreen(x1, y1);
    ctx.fillStyle = ORDER_COLORS[pr.order];
    ctx.globalAlpha = 0.25;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ORDER_COLORS[pr.order];
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
}
