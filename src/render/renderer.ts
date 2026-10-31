import { BUILD, BUSH_MAX_BERRIES, CROP } from '../sim/balance';
import { jobFraction } from '../sim/jobs';
import type { Point } from '../sim/pathfinding';
import type { GameMap } from '../sim/map';
import type { World } from '../sim/world';
import type { Camera } from './camera';
import type { Frame } from './pawnArt';
import { BERRY_SPOTS, TILE, bushSprite, cropSprite, itemSprite, paintCell, pawnSprite, structureSprite } from './sprites';

const COLORS = {
  bg: '#14171A',
  accent: '#E8A33D',
  blueprint: '#5AA9E6',
  good: '#8FBF5A',
} as const;

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

  /**
   * Пиксель-арт при дробном масштабе размывается билинейно из 3×-текстуры (мягкий пиксель),
   * а при кратном или большом — рисуется чётко.
   */
  private smooth(z: number): boolean {
    return z < TILE && z % 16 !== 0;
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
        const y = (idx - x) / this.map.width;
        this.terrainCtx.clearRect(x * TILE, y * TILE, TILE, TILE);
        paintCell(this.terrainCtx, this.map, x, y);
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

    ctx.imageSmoothingEnabled = this.smooth(z);
    ctx.drawImage(this.terrain, origin.x, origin.y, mapPxW, mapPxH);

    // Сетка — едва заметная, только при крупном масштабе: в пиксель-арте клетки и так видны.
    if (z >= 40) {
      const tl = cam.screenToWorld(0, 0);
      const br = cam.screenToWorld(this.viewW, this.viewH);
      const x0 = Math.max(0, Math.floor(tl.x));
      const x1 = Math.min(world.map.width, Math.ceil(br.x));
      const y0 = Math.max(0, Math.floor(tl.y));
      const y1 = Math.min(world.map.height, Math.ceil(br.y));
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
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

    ctx.imageSmoothingEnabled = this.smooth(z);
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
  private drawOverlays(world: World, cam: Camera, view: View): void {
    const ctx = this.ctx;
    if (view.showRooms) {
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

    // посевы: три стадии роста
    for (const [idx, c] of world.map.crops) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const f = c.growth / CROP.growTicks;
      ctx.drawImage(cropSprite(f >= 1 ? 2 : f >= 0.4 ? 1 : 0), r.x, r.y, r.s, r.s);
    }

    // приказы на деревья, камень, разборку
    ctx.lineWidth = 2;
    for (const [idx, d] of world.designations) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      const color = d === 'chop' ? COLORS.blueprint : d === 'mine' ? COLORS.accent : '#F08A7E';
      ctx.fillStyle = d === 'chop' ? 'rgba(90,169,230,0.30)' : d === 'mine' ? 'rgba(232,163,61,0.30)' : 'rgba(240,138,126,0.32)';
      ctx.fillRect(r.x, r.y, r.s, r.s);
      ctx.strokeStyle = color;
      ctx.strokeRect(r.x + 2, r.y + 2, r.s - 4, r.s - 4);
    }

    // чертежи: полупрозрачная постройка, пунктир и полоска прогресса
    for (const [idx, bp] of world.blueprints) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(structureSprite(bp.kind), r.x, r.y, r.s, r.s);
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
      ctx.fillRect(r.x + r.s * 0.06, r.y + r.s * 0.06, Math.max(3, r.s * 0.16), Math.max(3, r.s * 0.16));
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + r.s * 0.06, r.y + r.s * 0.06, Math.max(3, r.s * 0.16), Math.max(3, r.s * 0.16));
    }
  }

  private drawBushes(world: World, cam: Camera): void {
    const ctx = this.ctx;
    const px = cam.zoom / 16;
    for (const [idx, b] of world.map.bushes) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      ctx.drawImage(bushSprite(), r.x, r.y, r.s, r.s);
      const shown = Math.min(b.berries, BUSH_MAX_BERRIES);
      for (let i = 0; i < shown; i++) {
        const [bx, by] = BERRY_SPOTS[i]!;
        ctx.fillStyle = '#9E2F2A';
        ctx.fillRect(r.x + bx * px - px * 0.3, r.y + by * px - px * 0.3, px * 2.6, px * 2.6);
        ctx.fillStyle = '#E4564D';
        ctx.fillRect(r.x + bx * px, r.y + by * px, px * 2, px * 2);
        ctx.fillStyle = '#F5A39A';
        ctx.fillRect(r.x + bx * px, r.y + by * px, px * 0.8, px * 0.8);
      }
    }
  }

  private drawItems(world: World, cam: Camera): void {
    const ctx = this.ctx;
    for (const [idx, s] of world.items.stacks) {
      const r = this.cellRect(cam, idx);
      if (!this.visible(r)) continue;
      ctx.drawImage(itemSprite(s.kind), r.x, r.y, r.s, r.s);
      if (r.s >= 22) {
        ctx.font = `700 ${Math.round(r.s * 0.34)}px ui-monospace, monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        const label = String(s.count);
        ctx.lineWidth = Math.max(2, r.s * 0.08);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, r.x + r.s - 2, r.y + r.s - 1);
        ctx.fillStyle = '#F2EEE6';
        ctx.fillText(label, r.x + r.s - 2, r.y + r.s - 1);
      }
    }
  }

  private drawPawns(world: World, cam: Camera, alpha: number, view: View): void {
    const ctx = this.ctx;
    const z = cam.zoom;

    // Путь и цель выбранного — цвет чертежей/прогресса.
    for (const p of world.pawns) {
      if (p.dead || view.selectedId !== p.id || p.path.length === 0) continue;
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

    // Рисуем сверху вниз по экрану, чтобы нижние закрывали верхних.
    const order = world.pawns.filter((p) => !p.buried).sort((a, b) => a.y - b.y);
    const size = z * 1.1;
    for (const p of order) {
      const px = p.prevX + (p.x - p.prevX) * alpha;
      const py = p.prevY + (p.y - p.prevY) * alpha;
      const ps = cam.worldToScreen(px + 0.5, py + 0.5);
      const sleeping = (p.job?.kind === 'sleep' && p.job.phase === 'act') || p.job?.kind === 'bedrest' || p.downed || p.dead || p.carriedBy !== null;
      const moving = p.job !== null && (p.job.phase === 'move' || p.job.phase === 'move2') && p.path.length > 0;
      const frame: Frame = moving ? (Math.floor((px + py) * 2.4) % 2 === 0 ? 'stepA' : 'stepB') : 'idle';
      const bob = moving ? Math.abs(Math.sin((px + py) * Math.PI * 2.4)) * z * 0.04 : 0;

      // тень и выделение у ног
      const footY = ps.y + z * 0.36;
      if (view.selectedId === p.id) {
        ctx.strokeStyle = '#E8E6E1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(ps.x, footY, z * 0.42, z * 0.17, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(ps.x, footY, z * 0.3, z * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();

      const sprite = pawnSprite(p.color, p.id, p.facing, frame);
      if (sleeping) {
        // спящий, раненый и погибший лежат на боку; погибший — серый
        ctx.save();
        if (p.dead) ctx.filter = 'grayscale(1) brightness(0.65)';
        ctx.translate(ps.x, ps.y + z * 0.12);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(sprite, -size / 2, -size * 0.55, size, size);
        ctx.restore();
        ctx.font = `700 ${Math.round(z * 0.3)}px ui-monospace, monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = p.dead ? '#A3A8AD' : p.downed ? '#F08A7E' : '#E8E6E1';
        ctx.fillText(p.dead ? '†' : p.downed ? '!' : 'z', ps.x + z * 0.25, ps.y - z * 0.2);
      } else {
        ctx.drawImage(sprite, ps.x - size / 2, ps.y + z * 0.36 - size * 0.92 - bob, size, size);
      }

      const frac = p.dead ? null : jobFraction(p);
      if (frac !== null) {
        const bw = Math.max(18, z * 0.9);
        const bh = Math.max(3, z * 0.11);
        const bx = ps.x - bw / 2;
        const by = ps.y - z * 0.78 - bh;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
        ctx.fillStyle = COLORS.blueprint;
        ctx.fillRect(bx, by, bw * frac, bh);
      }
      if (p.carrying && !p.dead) {
        const s = z * 0.5;
        ctx.drawImage(itemSprite(p.carrying.kind), ps.x + z * 0.12, ps.y - z * 0.1 - bob, s, s);
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
