import { registerSW } from 'virtual:pwa-register';
import { attachGestures } from './input/gestures';
import { Camera } from './render/camera';
import { Renderer, type DrawRect } from './render/renderer';
import { MAX_TICKS_PER_FRAME, SPEED_MULTIPLIERS, TICK_MS } from './sim/balance';
import { Terrain } from './sim/map';
import { World, gameTime } from './sim/world';
import { Hud, type OrderMode } from './ui/hud';
import { TopBar } from './ui/topbar';

registerSW({ immediate: true });

// ?seed=123 — зафиксировать карту; иначе сид из времени.
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Date.now() % 1_000_000;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = new World(seed);
const camera = new Camera(world.map.width, world.map.height);
const renderer = new Renderer(canvas, world.map);

let selectedId: number | null = null;
let orderMode: OrderMode | null = null;
let preview: DrawRect | null = null;
let drawFrom: { x: number; y: number } | null = null;

// --- скорость ---
let speedIndex = 1;
let lastRunningSpeed = 1;
const topbar = new TopBar(
  document.getElementById('topbar') as HTMLElement,
  (i) => {
    // Повторное нажатие на «II» на паузе возобновляет игру.
    speedIndex = i === 0 && speedIndex === 0 ? lastRunningSpeed : i;
    if (speedIndex !== 0) lastRunningSpeed = speedIndex;
    topbar.setSpeed(speedIndex);
  },
  (id) => {
    select(id);
    centerOn(id);
  },
);
topbar.setSpeed(speedIndex);
topbar.setPawns(world.pawns.map((p) => ({ id: p.id, name: p.name, color: p.color })));

function select(id: number | null): void {
  selectedId = id;
  topbar.setSelected(id);
  hud.setSelected(id);
}

function centerOn(id: number): void {
  const p = world.pawns[id];
  if (p) camera.centerOn(p.x + 0.5, p.y + 0.5);
}

const hud = new Hud(document.getElementById('hud') as HTMLElement, world, {
  onSelectPawn: select,
  onCenterPawn: centerOn,
  onOrderMode: (m) => {
    orderMode = m;
    gestures.draw = m !== null;
    preview = null;
    drawFrom = null;
  },
  onPriority: (pawnId, work, value) => world.setPriority(pawnId, work, value),
  onNewMap: () => {
    location.search = `?seed=${1 + Math.floor(Math.random() * 999_999)}`;
  },
});

// --- размер ---
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h, window.devicePixelRatio || 1);
  camera.setViewport(w, h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();
centerOn(0);

// --- ввод ---
function cellAt(sx: number, sy: number): { x: number; y: number } {
  const w = camera.screenToWorld(sx, sy);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

/** Поселенец, на которого указывает касание (ближайший в радиусе ~0.8 клетки). */
function pawnAt(sx: number, sy: number): number | null {
  const w = camera.screenToWorld(sx, sy);
  let best: number | null = null;
  let bestD = 0.8;
  for (const p of world.pawns) {
    const d = Math.hypot(p.x + 0.5 - w.x, p.y + 0.5 - w.y);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

const ORDER_EMPTY: Record<OrderMode, string> = {
  chop: 'Здесь нет деревьев',
  mine: 'Здесь нет камня',
  zone: 'Сюда нельзя положить склад',
  erase: 'Здесь нечего стирать',
};

function applyArea(mode: OrderMode, a: { x: number; y: number }, b: { x: number; y: number }): void {
  if (world.applyOrder(mode, a.x, a.y, b.x, b.y) === 0) hud.showToast(ORDER_EMPTY[mode]);
}

const gestures = attachGestures(canvas, {
  onPan: (dx, dy) => camera.panBy(dx, dy),
  onPinch: (cx, cy, scale, dx, dy) => {
    camera.zoomAt(cx, cy, scale);
    camera.panBy(dx, dy);
  },
  onTap: (sx, sy) => {
    hud.hideMenu();
    if (orderMode) {
      const c = cellAt(sx, sy);
      applyArea(orderMode, c, c);
      return;
    }
    select(pawnAt(sx, sy)); // тап по пустому месту снимает выделение
  },
  onDoubleTap: () => {
    const id = selectedId ?? 0;
    centerOn(id);
  },
  onLongPress: (sx, sy) => {
    const hit = pawnAt(sx, sy);
    if (hit !== null) {
      select(hit);
      return;
    }
    const c = cellAt(sx, sy);
    if (!world.map.inBounds(c.x, c.y)) return;
    const idx = c.y * world.map.width + c.x;
    const items: { label: string; action: () => void }[] = [];
    if (selectedId !== null && world.map.isPassable(c.x, c.y)) {
      const id = selectedId;
      items.push({
        label: 'Идти сюда',
        action: () => {
          if (!world.moveTo(id, c.x, c.y)) hud.showToast('Туда не пройти');
        },
      });
    }
    const t = world.map.get(c.x, c.y);
    const d = world.designations.get(idx);
    if (t === Terrain.Tree || t === Terrain.Stone) {
      const mode: OrderMode = t === Terrain.Tree ? 'chop' : 'mine';
      if (d) items.push({ label: 'Отменить приказ', action: () => void world.applyOrder('erase', c.x, c.y, c.x, c.y) });
      else items.push({ label: t === Terrain.Tree ? 'Рубить' : 'Добывать', action: () => void world.applyOrder(mode, c.x, c.y, c.x, c.y) });
    }
    hud.showMenu(sx, sy, items);
  },
  onDrawStart: (sx, sy) => {
    drawFrom = cellAt(sx, sy);
  },
  onDrawMove: (sx, sy) => {
    if (!drawFrom || !orderMode) return;
    const c = cellAt(sx, sy);
    preview = { order: orderMode, x0: drawFrom.x, y0: drawFrom.y, x1: c.x, y1: c.y };
  },
  onDrawEnd: (sx, sy) => {
    if (drawFrom && orderMode) applyArea(orderMode, drawFrom, cellAt(sx, sy));
    drawFrom = null;
    preview = null;
  },
  onDrawCancel: () => {
    drawFrom = null;
    preview = null;
  },
  onWheel: (sx, sy, factor) => camera.zoomAt(sx, sy, factor),
});

// --- цикл: фиксированный тик + отрисовка на каждый кадр ---
let last = performance.now();
let acc = 0;
let frames = 0;
let fpsSince = last;

function frame(now: number): void {
  const dt = Math.min(now - last, 250);
  last = now;

  const mult = SPEED_MULTIPLIERS[speedIndex]!;
  let alpha = 1;
  if (mult > 0) {
    acc += dt * mult;
    let n = 0;
    while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
      world.tick();
      acc -= TICK_MS;
      n++;
    }
    if (n === MAX_TICKS_PER_FRAME) acc = 0;
    alpha = acc / TICK_MS;
  }

  renderer.draw(world, camera, alpha, { selectedId, preview });
  hud.update(now);

  const t = gameTime(world.tickCount);
  topbar.setTime(`День ${t.day} · ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`);

  frames++;
  if (now - fpsSince >= 500) {
    topbar.setFps(Math.round((frames * 1000) / (now - fpsSince)));
    frames = 0;
    fpsSince = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Для отладки и автотестов в браузере.
(window as unknown as { __colony: unknown }).__colony = { world, camera, select };
