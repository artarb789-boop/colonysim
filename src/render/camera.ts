export const MIN_ZOOM = 10; // пикселей на клетку
export const MAX_ZOOM = 64;

/** Камера: (x, y) — центр вида в координатах клеток, zoom — CSS-пикселей на клетку. Без DOM. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 28;
  viewW = 1;
  viewH = 1;

  constructor(
    private readonly mapW: number,
    private readonly mapH: number,
  ) {
    this.x = mapW / 2;
    this.y = mapH / 2;
  }

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    this.clamp();
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x,
      y: (sy - this.viewH / 2) / this.zoom + this.y,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  panBy(dxPx: number, dyPx: number): void {
    this.x -= dxPx / this.zoom;
    this.y -= dyPx / this.zoom;
    this.clamp();
  }

  /** Масштаб с сохранением точки под пальцем (sx, sy). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    this.x = before.x - (sx - this.viewW / 2) / this.zoom;
    this.y = before.y - (sy - this.viewH / 2) / this.zoom;
    this.clamp();
  }

  centerOn(wx: number, wy: number): void {
    this.x = wx;
    this.y = wy;
    this.clamp();
  }

  /** Центр вида не уходит за пределы карты. */
  private clamp(): void {
    this.x = Math.min(this.mapW, Math.max(0, this.x));
    this.y = Math.min(this.mapH, Math.max(0, this.y));
  }
}
