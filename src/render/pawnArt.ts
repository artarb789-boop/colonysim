/**
 * Пиксель-арт поселенца 16×16 (чистые данные, без DOM — проверяется тестами).
 * Символы: h волосы, S кожа, e глаз, b рубашка, a рукав (тёмнее), s кисть, l штаны, f ботинки, . прозрачно.
 */
export type Dir = 'down' | 'up' | 'left' | 'right';
export type Frame = 'idle' | 'stepA' | 'stepB';

const HEAD_BODY: Record<'down' | 'up' | 'left', string[]> = {
  down: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hhSSSSSShh...',
    '...hSSeSSeSSh...',
    '....SSSSSSSS....',
    '.....SSSSSS.....',
    '..aabbbbbbbbaa..',
    '..abbbbbbbbbba..',
    '..abbbbbbbbbba..',
    '..ssbbbbbbbbss..',
  ],
  up: [
    '................',
    '....hhhhhhhh....',
    '...hhhhhhhhhh...',
    '...hhhhhhhhhh...',
    '...hhhhhhhhhh...',
    '....hhhhhhhh....',
    '.....SSSSSS.....',
    '..aabbbbbbbbaa..',
    '..abbbbbbbbbba..',
    '..abbbbbbbbbba..',
    '..ssbbbbbbbbss..',
  ],
  left: [
    '................',
    '....hhhhhhh.....',
    '...hhhhhhhhh....',
    '...hhhSSSSS.....',
    '...hhSeSSSS.....',
    '....hSSSSSS.....',
    '.....SSSSS......',
    '....aabbbbb.....',
    '....abbbbbbb....',
    '....abbbbbbb....',
    '....ssbbbbb.....',
  ],
};

const LEGS: Record<'front' | 'side', Record<Frame, string[]>> = {
  front: {
    idle: ['....llllllll....', '....lll..lll....', '....lll..lll....', '....fff..fff....'],
    stepA: ['....llllllll....', '....lll..lll....', '....lll...lll...', '....fff...fff...'],
    stepB: ['....llllllll....', '....lll..lll....', '...lll...lll....', '...fff...fff....'],
  },
  side: {
    idle: ['....lllllll.....', '.....llll.......', '.....llll.......', '.....ffff.......'],
    stepA: ['....lllllll.....', '....ll..lll.....', '...ll....ll.....', '...ff....ff.....'],
    stepB: ['....lllllll.....', '.....llllll.....', '.....ll.ll......', '.....ff.ff......'],
  },
};

const pad = (row: string) => row;

/** 15 строк (корпус + ноги) для направления и кадра. Правое направление — зеркало левого. */
export function pawnRows(dir: Dir, frame: Frame): string[] {
  const mirrored = dir === 'right';
  const base = dir === 'right' ? 'left' : dir;
  const legs = LEGS[base === 'left' ? 'side' : 'front'][frame];
  const rows = [...HEAD_BODY[base], ...legs, '................'].map(pad);
  return mirrored ? rows.map((r) => [...r].reverse().join('')) : rows;
}

/** Направление взгляда (радианы, 0 — вправо, π/2 — вниз) → одно из четырёх. */
export function dirOf(angle: number): Dir {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}
