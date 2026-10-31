import type { World } from '../sim/world';
import { jobFraction, type JobKind, type WorkType } from '../sim/jobs';
import type { ItemKind } from '../sim/items';
import type { MoodKey } from '../sim/mood';
import type { Pawn, SkillId } from '../sim/pawn';

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
  cooking: 'обеды на плите',
  plants: 'рубка, ягоды, огород',
  mining: 'добыча камня',
  hauling: 'на склад-зону',
};

export const ITEM_LABELS: Record<ItemKind, string> = { wood: 'Дерево', stone: 'Камень', berries: 'Ягоды', rice: 'Рис', meal: 'Обеды', silver: 'Серебро', club: 'Дубины', bow: 'Луки' };

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
  cook: 'Готовит обед',
  wander: 'Срыв: бродит',
  stroll: 'Прогуливается',
  equip: 'Берёт оружие',
  fight: 'Сражается',
  treat: 'Лечит',
  rescue: 'Несёт раненого',
  bury: 'Хоронит',
  bedrest: 'Лежит в постели',
  downed: 'Без сознания',
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
  if (j.kind === 'cook' && j.phase === 'move') return 'Идёт за продуктами';
  if (j.kind === 'sleep' && j.phase === 'move') return 'Идёт спать';
  if ((j.kind === 'sleep' || j.kind === 'relax') && j.phase === 'move') return 'Устал, ищет место';
  return JOB_LABELS[j.kind];
}

/** 0..1, если у задачи есть измеримый прогресс. */
export function jobProgress(_world: World, p: Pawn): number | null {
  return jobFraction(p);
}

export const NEED_LABELS = { food: 'Еда', sleep: 'Сон', rest: 'Отдых' } as const;

export const THOUGHT_LABELS: Record<MoodKey, string> = {
  ateMeal: 'Вкусный ужин',
  ateRaw: 'Ел сырое',
  sleptOnFloor: 'Спал на полу',
  sleptInBed: 'Спал в кровати',
  ownBedroom: 'Своя спальня',
  catharsis: 'Выпустил пар',
  hungry: 'Голод',
  starving: 'Страшный голод',
  tired: 'Хочет спать',
  exhausted: 'Нужен отдых',
  cold: 'Холодно',
  freezing: 'Лютый холод',
  hot: 'Жарко',
  sick: 'Болезнь',
  optimist: 'Характер: оптимист',
  pessimist: 'Характер: пессимист',
  sawCorpse: 'Видел труп',
  colonistDied: 'Погиб товарищ',
  pain: 'Боль',
};

export const SKILL_LABELS: Record<SkillId, string> = {
  construction: 'Строительство',
  crafting: 'Ремесло',
  mining: 'Добыча',
  cooking: 'Готовка',
  plants: 'Растения',
  shooting: 'Стрельба',
  medicine: 'Медицина',
  social: 'Общение',
  intellect: 'Интеллект',
};

/** Класс цвета для настроения в процентах. */
export function moodClass(mood: number): 'good' | 'warn' | 'bad' {
  return mood < 25 ? 'bad' : mood < 45 ? 'warn' : 'good';
}
