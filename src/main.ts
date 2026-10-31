import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

// Подгоняем размер буфера под экран и плотность пикселей; срабатывает и при повороте.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
  hud.textContent = `${w}×${h} @${dpr.toFixed(2)}x ${w > h ? 'горизонтально' : 'вертикально'}`;
}

function draw(): void {
  ctx.fillStyle = '#14171A';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();
