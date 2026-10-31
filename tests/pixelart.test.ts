import { describe, expect, it } from 'vitest';
import { dirOf, pawnRows, type Dir, type Frame } from '../src/render/pawnArt';

const dirs: Dir[] = ['down', 'up', 'left', 'right'];
const frames: Frame[] = ['idle', 'stepA', 'stepB'];

describe('пиксель-арт поселенца', () => {
  it('все кадры — ровно 16×16', () => {
    for (const d of dirs)
      for (const f of frames) {
        const rows = pawnRows(d, f);
        expect(rows, `${d}/${f}`).toHaveLength(16);
        rows.forEach((r, i) => expect(r.length, `${d}/${f} строка ${i}`).toBe(16));
      }
  });

  it('используются только известные символы', () => {
    const ok = new Set('.hSebasflsl'.split(''));
    for (const d of dirs) for (const f of frames) for (const r of pawnRows(d, f)) for (const ch of r) expect(ok.has(ch)).toBe(true);
  });

  it('правый вид — зеркало левого', () => {
    for (const f of frames) {
      const l = pawnRows('left', f);
      const r = pawnRows('right', f);
      l.forEach((row, i) => expect([...row].reverse().join('')).toBe(r[i]));
    }
  });

  it('лицо видно спереди и сбоку, но не сзади', () => {
    expect(pawnRows('down', 'idle').join('')).toContain('e');
    expect(pawnRows('left', 'idle').join('')).toContain('e');
    expect(pawnRows('up', 'idle').join('')).not.toContain('e');
  });

  it('кадры ходьбы отличаются от стояния и друг от друга', () => {
    for (const d of dirs) {
      const idle = pawnRows(d, 'idle').join('/');
      const a = pawnRows(d, 'stepA').join('/');
      const b = pawnRows(d, 'stepB').join('/');
      expect(a).not.toBe(idle);
      expect(b).not.toBe(idle);
      expect(a).not.toBe(b);
    }
  });

  it('направление по углу взгляда', () => {
    expect(dirOf(0)).toBe('right');
    expect(dirOf(Math.PI / 2)).toBe('down');
    expect(dirOf(Math.PI)).toBe('left');
    expect(dirOf(-Math.PI / 2)).toBe('up');
    expect(dirOf(Math.PI / 4 + 0.01)).toBe('down'); // чуть больше 45° — вниз ближе
    expect(dirOf(Math.PI / 4 - 0.01)).toBe('right');
    expect(dirOf(-Math.PI / 4 + 0.01)).toBe('right');
  });
});
