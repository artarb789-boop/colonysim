/**
 * Пиксель-арт поселенца 16×16 (чистые данные, без DOM — проверяется тестами).
 * Символы: o контур, h/H волосы, S/k кожа, e глаз, b/B/a куртка, s кисть, l/L штаны, t ремень, f ботинки, . прозрачно.
 */
export type Dir = 'down' | 'up' | 'left' | 'right';
export type Frame = 'idle' | 'stepA' | 'stepB';

// Контур отделяет фигуру от земли; свет падает сверху слева.
const HEAD_BODY: Record<'down' | 'up' | 'left', string[]> = {
  down: [
    '......ooooo.....',
    '.....ohHHhho....',
    '.....ohhhHhho...',
    '.....oSSSSSko...',
    '.....oSeSeko....',
    '......SSSSk.....',
    '....ooaSSaoo....',
    '...oBbabbbao....',
    '...oSbabbbaSo...',
    '....oaattao.....',
  ],
  up: [
    '......ooooo.....',
    '.....ohHHhho....',
    '.....ohhhhhho...',
    '.....ohhhhho....',
    '.....ohhhhho....',
    '......ohho......',
    '....ooaaaaoo....',
    '...oBbbbbbao....',
    '...oSbbabbaSo...',
    '....oaattao.....',
  ],
  left: [
    '......oooo......',
    '.....ohHHho.....',
    '....ohhhhho.....',
    '....oSSkhho.....',
    '...oSeSkhho.....',
    '....oSSko.......',
    '.....oSaoo......',
    '....oBbbbao.....',
    '....oBabbao.....',
    '....oSattao.....',
  ],
};

const LEGS: Record<'front' | 'side', Record<Frame, string[]>> = {
  front: {
    idle: ['....ollLllo.....', '....ololLlo.....', '....ofo.ofo.....', '....ooo.ooo.....'],
    stepA: ['....ollLllo.....', '....ololLlo.....', '...offo.olo.....', '...oooo.offo....'],
    stepB: ['....ollLllo.....', '....ollolo......', '....olo.offo....', '...offo.oooo....'],
  },
  side: {
    idle: ['.....olllo......', '.....olLlo......', '.....offo.......', '.....oooo.......'],
    stepA: ['.....ollllo.....', '....ollollo.....', '...offo.olo.....', '...oooo.offo....'],
    stepB: ['.....ollllo.....', '.....ollolo.....', '.....olo.ffo....', '....offo.ooo....'],
  },
};

/** 16×16, четыре направления и три кадра; справа — зеркало левого вида. */
export function pawnRows(dir: Dir, frame: Frame): string[] {
  const base = dir === 'right' ? 'left' : dir;
  const rows = ['................', ...HEAD_BODY[base], ...LEGS[base === 'left' ? 'side' : 'front'][frame], '................'];
  return dir === 'right' ? rows.map((r) => [...r].reverse().join('')) : rows;
}

/** Направление взгляда (радианы, 0 — вправо, π/2 — вниз) → одно из четырёх. */
export function dirOf(angle: number): Dir {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

