import type { Camera } from './camera';
import { Terrain, type GameMap } from '../sim/map';
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
  accent: '#E8A33D',
  blueprint: '#5AA9E6',
} as const;

function buildTerrainTexture(map: GameMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.width * TILE;
  c.height = map.height * TILE;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
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
  }
  return c;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly terrain: HTMLCanvasElement;
  private viewW = 1;
  private viewH = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    map: GameMap,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.terrain = buildTerrainTexture(map);
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
  draw(world: World, cam: Camera, alpha: number): void {
    const ctx = this.ctx;
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

    const p = world.pawn;
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const py = p.prevY + (p.y - p.prevY) * alpha;
    const ps = cam.worldToScreen(px + 0.5, py + 0.5);

    // Путь и цель — цвет чертежей/прогресса.
    if (p.path.length > 0) {
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
    }
    if (p.target) {
      const t = cam.worldToScreen(p.target.x, p.target.y);
      ctx.strokeStyle = COLORS.blueprint;
      ctx.lineWidth = 2;
      ctx.strokeRect(t.x + 2, t.y + 2, z - 4, z - 4);
    }

    // Поселенец: цветной круг с инициалом.
    const r = z * 0.38;
    ctx.fillStyle = COLORS.accent;
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
  }
}
