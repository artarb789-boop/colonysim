import { registerSW } from 'virtual:pwa-register';
import { attachGestures } from './input/gestures';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { MAX_TICKS_PER_FRAME, SPEED_MULTIPLIERS, TICK_MS } from './sim/balance';
import { World, gameTime } from './sim/world';
import { TopBar } from './ui/topbar';

registerSW({ immediate: true });

const canvas = document.getElementById('game') as HTMLCanvasElement;
const world = new World(Date.now() % 1_000_000);
const camera = new Camera(world.map.width, world.map.height);
const renderer = new Renderer(canvas, world.map);

// --- скорость ---
let speedIndex = 1;
let lastRunningSpeed = 1;
const topbar = new TopBar(document.getElementById('topbar') as HTMLElement, (i) => {
  // Повторное нажатие на «II» на паузе возобновляет игру.
  speedIndex = i === 0 && speedIndex === 0 ? lastRunningSpeed : i;
  if (speedIndex !== 0) lastRunningSpeed = speedIndex;
  topbar.setSpeed(speedIndex);
});
topbar.setSpeed(speedIndex);

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
camera.centerOn(world.pawn.x + 0.5, world.pawn.y + 0.5);

// --- ввод ---
attachGestures(canvas, {
  onPan: (dx, dy) => camera.panBy(dx, dy),
  onPinch: (cx, cy, scale, dx, dy) => {
    camera.zoomAt(cx, cy, scale);
    camera.panBy(dx, dy);
  },
  onTap: (sx, sy) => {
    const w = camera.screenToWorld(sx, sy);
    world.moveTo(Math.floor(w.x), Math.floor(w.y));
  },
  onDoubleTap: () => camera.centerOn(world.pawn.x + 0.5, world.pawn.y + 0.5),
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

  renderer.draw(world, camera, alpha);

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
(window as unknown as { __colony: unknown }).__colony = { world, camera };
