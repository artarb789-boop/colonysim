export interface GestureHandlers {
  onPan(dx: number, dy: number): void;
  /** scale — отношение новых расстояний между пальцами к старым; (cx, cy) — центр щипка; (dx, dy) — его сдвиг. */
  onPinch(cx: number, cy: number, scale: number, dx: number, dy: number): void;
  onTap(x: number, y: number): void;
  onDoubleTap(x: number, y: number): void;
  /** Долгое нажатие (~400 мс без движения). В режиме рисования не вызывается. */
  onLongPress(x: number, y: number): void;
  /** Рисование области одним пальцем (только когда controller.draw = true). */
  onDrawStart(x: number, y: number): void;
  onDrawMove(x: number, y: number): void;
  onDrawEnd(x: number, y: number): void;
  onDrawCancel(): void;
  /** factor > 1 — приблизить. Колесо мыши (для отладки на компьютере). */
  onWheel(x: number, y: number, factor: number): void;
}

export interface GestureController {
  /** true — перетаскивание одним пальцем рисует область вместо панорамы. */
  draw: boolean;
}

const SLOP = 8; // px: меньше — это ещё тап
const TAP_MAX_MS = 400;
const LONG_PRESS_MS = 400;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 40;

interface P {
  x: number;
  y: number;
}

export function attachGestures(el: HTMLElement, h: GestureHandlers): GestureController {
  const ctl: GestureController = { draw: false };
  const ptrs = new Map<number, P>();
  let start: P = { x: 0, y: 0 };
  let downAt = 0;
  let moved = false;
  let multi = false;
  let drawing = false;
  let longFired = false;
  let longTimer = 0;
  let lastTap = { t: -Infinity, x: 0, y: 0 };

  const clearLong = () => {
    window.clearTimeout(longTimer);
    longTimer = 0;
  };

  el.addEventListener('pointerdown', (e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // указатель мог уже исчезнуть — не критично
    }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) {
      start = { x: e.clientX, y: e.clientY };
      downAt = performance.now();
      moved = false;
      multi = false;
      drawing = false;
      longFired = false;
      clearLong();
      if (!ctl.draw) {
        longTimer = window.setTimeout(() => {
          if (ptrs.size === 1 && !moved && !multi) {
            longFired = true;
            h.onLongPress(start.x, start.y);
          }
        }, LONG_PRESS_MS);
      }
    } else {
      multi = true;
      clearLong();
      if (drawing) {
        drawing = false;
        h.onDrawCancel();
      }
    }
  });

  el.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    const cur: P = { x: e.clientX, y: e.clientY };

    if (ptrs.size === 1 && !multi) {
      if (!moved) {
        if (Math.hypot(cur.x - start.x, cur.y - start.y) <= SLOP) return;
        moved = true;
        clearLong();
        if (ctl.draw) {
          drawing = true;
          h.onDrawStart(start.x, start.y);
          h.onDrawMove(cur.x, cur.y);
        } else {
          h.onPan(cur.x - start.x, cur.y - start.y);
        }
      } else if (drawing) {
        h.onDrawMove(cur.x, cur.y);
      } else if (!longFired) {
        h.onPan(cur.x - prev.x, cur.y - prev.y);
      }
      ptrs.set(e.pointerId, cur);
    } else if (ptrs.size === 2) {
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)![1];
      const oldDist = Math.hypot(prev.x - other.x, prev.y - other.y);
      const newDist = Math.hypot(cur.x - other.x, cur.y - other.y);
      const oldC = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const newC = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      ptrs.set(e.pointerId, cur);
      if (oldDist > 0 && newDist > 0) h.onPinch(newC.x, newC.y, newDist / oldDist, newC.x - oldC.x, newC.y - oldC.y);
    } else {
      ptrs.set(e.pointerId, cur);
    }
  });

  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!ptrs.has(e.pointerId)) return;
    const wasSingle = ptrs.size === 1 && !multi;
    ptrs.delete(e.pointerId);
    clearLong();
    if (ptrs.size === 0) {
      const now = performance.now();
      if (drawing) {
        drawing = false;
        if (cancelled) h.onDrawCancel();
        else h.onDrawEnd(e.clientX, e.clientY);
      } else if (!cancelled && wasSingle && !moved && !longFired && now - downAt < TAP_MAX_MS) {
        const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_DIST;
        if (now - lastTap.t < DOUBLE_TAP_MS && near) {
          lastTap.t = -Infinity;
          h.onDoubleTap(e.clientX, e.clientY);
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          h.onTap(e.clientX, e.clientY);
        }
      }
      multi = false;
    }
  };
  el.addEventListener('pointerup', (e) => end(e, false));
  el.addEventListener('pointercancel', (e) => end(e, true));

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      h.onWheel(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  return ctl;
}
