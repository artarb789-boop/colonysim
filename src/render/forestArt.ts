import atlasUrl from './art/forest.webp';
import type { Dir, Frame } from './pawnArt';

const SIZE = 96;
const cells: HTMLCanvasElement[] = [];
export async function loadForestArt(): Promise<void> {
  const image = new Image();
  image.src = atlasUrl;
  await image.decode();
  for (let i = 0; i < 12; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    canvas.getContext('2d')!.drawImage(image, i % 6 * SIZE, Math.floor(i / 6) * SIZE,
      SIZE, SIZE, 0, 0, SIZE, SIZE);
    cells[i] = canvas;
  }
}

export const forestCell = (i: number): HTMLCanvasElement => cells[i]!;

export function forestPawn(color: string, id: number, dir: Dir, frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const side = dir === 'left' || dir === 'right';
  const source = forestCell((id % 2) * 3 + (side ? 1 : dir === 'up' ? 2 : 0));
  ctx.translate(SIZE / 2, SIZE);
  if (dir === 'left') ctx.scale(-1, 1);
  const stride = frame === 'stepA' ? 1 : frame === 'stepB' ? -1 : 0;
  ctx.rotate(stride * 0.025);
  ctx.drawImage(source, -SIZE / 2, -SIZE);
  // Цвет куртки помогает найти выбранного поселенца и отличить налётчика.
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
  const rgb = parseInt(color.slice(1), 16);
  for (let y = 50; y < 71; y++) for (let x = 0; x < SIZE; x++) {
    const k = (y * SIZE + x) * 4;
    const r = pixels.data[k]!, g = pixels.data[k + 1]!, b = pixels.data[k + 2]!;
    if (!pixels.data[k + 3] || r < 48 || b > g || g > r * 1.12) continue;
    const light = Math.min(1, (r + g) / 260);
    pixels.data[k] = ((rgb >> 16) & 255) * light;
    pixels.data[k + 1] = ((rgb >> 8) & 255) * light;
    pixels.data[k + 2] = (rgb & 255) * light;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
