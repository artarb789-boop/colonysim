import { registerSW } from 'virtual:pwa-register';
import { attachGestures } from './input/gestures';
import { Camera } from './render/camera';
import { isBuildTool, TOOL_COLORS, type Tool } from './input/tools';
import { Renderer, type View } from './render/renderer';
import { clearGame, loadGame, saveGame } from './save/storage';
import { DAY_TICKS, MAX_TICKS_PER_FRAME, SPEED_MULTIPLIERS, TICK_MS } from './sim/balance';
import { cellsOf, shapeOf } from './sim/build';
import { Terrain } from './sim/map';
import { darknessAt } from './sim/climate';
import { restoreWorld, serializeWorld } from './sim/serialize';
import { World, gameTime } from './sim/world';
import { Hud, type MenuItem } from './ui/hud';
import { TopBar } from './ui/topbar';

registerSW({ immediate: true });

// Запуск: ?seed=123 — новая игра на этой карте; иначе продолжаем сохранённую; иначе новая со случайным сидом.
const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const forcedSeed = Number.isInteger(seedParam) && seedParam > 0;
if (forcedSeed) history.replaceState(null, '', location.pathname); // чтобы перезагрузка не сбрасывала игру

const savedFile = forcedSeed ? null : await loadGame();
const restored = savedFile ? restoreWorld(savedFile.sim) : null;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = restored ?? new World(forcedSeed ? seedParam : Date.now() % 1_000_000);
const camera = new Camera(world.map.width, world.map.height);
const renderer = new Renderer(canvas, world.map);
if (restored && savedFile) {
  camera.zoomAt(camera.viewW / 2, camera.viewH / 2, savedFile.camera.zoom / camera.zoom);
  camera.centerOn(savedFile.camera.x, savedFile.camera.y);
}

// --- сохранение ---
let leaving = false;
async function save(): Promise<boolean> {
  if (leaving) return false;
  return saveGame({
    sim: serializeWorld(world),
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
    savedAt: Date.now(),
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void save();
});
window.addEventListener('pagehide', () => void save());
let lastDay = Math.floor(world.tickCount / DAY_TICKS);

let selectedId: number | null = null;
let tool: Tool | null = null;
let preview: View['preview'] = null;
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
topbar.setPawns(world.living.map((p) => ({ id: p.id, name: p.name, color: p.color })));

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
  onTool: (t) => {
    tool = t;
    gestures.draw = t !== null;
    preview = null;
    drawFrom = null;
  },
  onPriority: (pawnId, work, value) => world.setPriority(pawnId, work, value),
  onSave: save,
  onSkip: (days) => {
    skipLeft = days * DAY_TICKS;
    hud.setBanner(`Перемотка: осталось ${days.toFixed(1)} сут.`);
  },
  onNewMap: () => {
    leaving = true;
    void clearGame().then(() => {
      location.search = `?seed=${1 + Math.floor(Math.random() * 999_999)}`;
    });
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
if (!restored) {
  centerOn(0);
  void save(); // сразу создаём сохранение для новой игры
}

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
    if (p.dead || p.carriedBy !== null) continue;
    const d = Math.hypot(p.x + 0.5 - w.x, p.y + 0.5 - w.y);
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}

const TOOL_EMPTY: Record<Tool, string> = {
  chop: 'Здесь нет деревьев',
  mine: 'Здесь нет камня',
  zone: 'Сюда нельзя положить склад',
  garden: 'Здесь нельзя разметить огород',
  deconstruct: 'Здесь нечего разбирать',
  erase: 'Здесь нечего стирать',
  wall: 'Здесь нельзя строить',
  door: 'Здесь нельзя строить',
  floor: 'Здесь нельзя строить',
  bed: 'Здесь нельзя строить',
  stove: 'Здесь нельзя строить',
};

type Cell = { x: number; y: number };

/** Клетки области: стены — линией, остальное — прямоугольником. */
function areaCells(t: Tool, a: Cell, b: Cell): Cell[] {
  return cellsOf(isBuildTool(t) ? shapeOf(t) : 'rect', a.x, a.y, b.x, b.y);
}

function applyArea(t: Tool, a: Cell, b: Cell): void {
  const cells = areaCells(t, a, b);
  const changed = isBuildTool(t) ? world.placeBlueprints(t, cells) : world.applyOrder(t, a.x, a.y, b.x, b.y);
  if (changed === 0) hud.showToast(TOOL_EMPTY[t]);
  else if (isBuildTool(t) && changed < cells.length) hud.showToast('Часть клеток занята — там чертежа нет');
}

const gestures = attachGestures(canvas, {
  onPan: (dx, dy) => camera.panBy(dx, dy),
  onPinch: (cx, cy, scale, dx, dy) => {
    camera.zoomAt(cx, cy, scale);
    camera.panBy(dx, dy);
  },
  onTap: (sx, sy) => {
    hud.hideMenu();
    if (tool) {
      const c = cellAt(sx, sy);
      applyArea(tool, c, c);
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
    const items: MenuItem[] = [];
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
    const cancel = () => void world.applyOrder('erase', c.x, c.y, c.x, c.y);
    if (t === Terrain.Tree || t === Terrain.Stone) {
      const order = t === Terrain.Tree ? 'chop' : 'mine';
      if (d) items.push({ label: 'Отменить приказ', action: cancel });
      else items.push({ label: t === Terrain.Tree ? 'Рубить' : 'Добывать', action: () => void world.applyOrder(order, c.x, c.y, c.x, c.y) });
    }
    const roomId = world.rooms().roomOf[idx]!;
    if (roomId >= 0) {
      const r = world.rooms().rooms[roomId]!;
      items.push({ label: `Комната: ${r.cells.length} кл., кроватей: ${r.beds.length}`, action: () => {}, info: true });
    }
    if (world.blueprints.has(idx)) items.push({ label: 'Отменить чертёж', action: cancel });
    else if (world.hasBuilt(idx)) {
      if (d === 'deconstruct') items.push({ label: 'Отменить разборку', action: cancel });
      else items.push({ label: 'Разобрать', action: () => void world.applyOrder('deconstruct', c.x, c.y, c.x, c.y) });
    }
    hud.showMenu(sx, sy, items);
  },
  onDrawStart: (sx, sy) => {
    drawFrom = cellAt(sx, sy);
  },
  onDrawMove: (sx, sy) => {
    if (!drawFrom || !tool) return;
    preview = { color: TOOL_COLORS[tool], cells: areaCells(tool, drawFrom, cellAt(sx, sy)) };
  },
  onDrawEnd: (sx, sy) => {
    if (drawFrom && tool) applyArea(tool, drawFrom, cellAt(sx, sy));
    drawFrom = null;
    preview = null;
  },
  onDrawCancel: () => {
    drawFrom = null;
    preview = null;
  },
  onWheel: (sx, sy, factor) => camera.zoomAt(sx, sy, factor),
});

// Лёгкий оттенок карты по сезонам: весна и лето без оттенка, осень тёплая, зима холодная.
const SEASON_TINT: (string | null)[] = [null, null, 'rgba(200,120,40,0.06)', 'rgba(210,225,255,0.12)'];
let chipSig = world.living.map((p) => p.id).join(',');
let skipLeft = 0;

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
  if (skipLeft > 0) {
    // перемотка: быстро прогоняем сутки пачками по кадрам
    const n = Math.min(skipLeft, 1500);
    for (let i = 0; i < n && !world.lost; i++) world.tick();
    skipLeft = world.lost ? 0 : skipLeft - n;
    acc = 0;
    hud.setBanner(skipLeft > 0 ? `Перемотка: осталось ${(skipLeft / DAY_TICKS).toFixed(1)} сут.` : null);
    if (skipLeft === 0) void save();
  } else if (mult > 0 && !world.lost) {
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

  const day = Math.floor(world.tickCount / DAY_TICKS);
  if (day !== lastDay) {
    lastDay = day;
    void save(); // автосейв раз в игровые сутки
  }

  renderer.draw(world, camera, alpha, {
    selectedId,
    preview,
    showRooms: hud.buildOpen,
    darkness: darknessAt(world.tickCount),
    tint: SEASON_TINT[world.season] ?? null,
  });
  hud.update(now);
  const sig = world.living.map((p) => p.id).join(',');
  if (sig !== chipSig) {
    chipSig = sig;
    topbar.setPawns(world.living.map((p) => ({ id: p.id, name: p.name, color: p.color })));
    topbar.setSelected(selectedId);
  }

  const t = gameTime(world.tickCount);
  topbar.setTime(`День ${t.day}`, `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`);

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
