import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM, MIN_ZOOM } from '../src/render/camera';

function cam(): Camera {
  const c = new Camera(60, 60);
  c.setViewport(891, 412);
  return c;
}

describe('Camera', () => {
  it('screenToWorld и worldToScreen обратимы', () => {
    const c = cam();
    c.x = 20;
    c.y = 33;
    c.zoom = 24;
    const s = c.worldToScreen(25.5, 30.25);
    const w = c.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(25.5);
    expect(w.y).toBeCloseTo(30.25);
  });

  it('центр экрана = центр камеры', () => {
    const c = cam();
    expect(c.screenToWorld(891 / 2, 412 / 2)).toEqual({ x: 30, y: 30 });
  });

  it('zoomAt сохраняет мировую точку под пальцем', () => {
    const c = cam();
    c.x = 25;
    c.y = 28;
    const before = c.screenToWorld(600, 100);
    c.zoomAt(600, 100, 1.7);
    const after = c.screenToWorld(600, 100);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('масштаб ограничен', () => {
    const c = cam();
    c.zoomAt(100, 100, 1000);
    expect(c.zoom).toBe(MAX_ZOOM);
    c.zoomAt(100, 100, 0.0001);
    expect(c.zoom).toBe(MIN_ZOOM);
  });

  it('панорама сдвигает карту вслед за пальцем и не уходит за карту', () => {
    const c = cam();
    c.zoom = 20;
    const x0 = c.x;
    c.panBy(40, 0); // палец вправо → вид влево
    expect(c.x).toBeCloseTo(x0 - 2);
    c.panBy(1e6, 1e6);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    c.panBy(-1e6, -1e6);
    expect(c.x).toBe(60);
    expect(c.y).toBe(60);
  });
});
