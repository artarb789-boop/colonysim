import type { World } from '../sim/world';
import type { JobKind, WorkType } from '../sim/jobs';
import type { ItemKind } from '../sim/items';
import type { Pawn } from '../sim/pawn';

export const WORK_LABELS: Record<WorkType, string> = {
  firefighting: 'Тушение',
  doctor: 'Лечение',
  cooking: 'Готовка',
  hunting: 'Охота',
  construction: 'Строительство',
  plants: 'Растения',
  mining: 'Добыча',
  crafting: 'Ремесло',
  hauling: 'Переноска',
  cleaning: 'Уборка',
  research: 'Исследования',
};

export const WORK_HINTS: Partial<Record<WorkType, string>> = {
  construction: 'стройка, подвоз, разборка',
  plants: 'рубка, ягоды, огород',
  mining: 'добыча камня',
  hauling: 'на склад-зону',
};

export const ITEM_LABELS: Record<ItemKind, string> = { wood: 'Дерево', stone: 'Камень', berries: 'Ягоды', rice: 'Рис' };

const JOB_LABELS: Record<JobKind, string> = {
  chop: 'Рубит дерево',
  mine: 'Добывает камень',
  harvest: 'Собирает ягоды',
  haul: 'Переносит на склад',
  sow: 'Сажает рис',
  reap: 'Собирает рис',
  deliver: 'Несёт материалы',
  build: 'Строит',
  deconstruct: 'Разбирает',
  eat: 'Ест',
  sleep: 'Спит',
  relax: 'Отдыхает',
  goto: 'Идёт по приказу',
};

export function jobLabel(p: Pawn): string {
  if (!p.job) return 'Свободен';
  const j = p.job;
  if (j.kind === 'eat' && j.phase === 'move') return 'Идёт поесть';
  if (j.kind === 'haul' && j.phase === 'move') return 'Идёт за грузом';
  if (j.kind === 'deliver' && j.phase === 'move') return 'Идёт за материалами';
  if ((j.kind === 'sleep' || j.kind === 'relax') && j.phase === 'move') return 'Устал, ищет место';
  return JOB_LABELS[j.kind];
}

/** 0..1, если у задачи есть измеримый прогресс. */
export function jobProgress(_world: World, p: Pawn): number | null {
  const j = p.job;
  if (!j || j.duration <= 0 || (j.phase !== 'act' && j.phase !== 'act2')) return null;
  return Math.min(1, j.progress / j.duration);
}

export const NEED_LABELS = { food: 'Еда', sleep: 'Сон', rest: 'Отдых' } as const;
