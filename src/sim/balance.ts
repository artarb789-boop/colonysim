// Все числа баланса — здесь (см. правила в CLAUDE.md).

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Множители скорости: 0 = пауза, затем 1×, 2×, 3×. */
export const SPEED_MULTIPLIERS = [0, 1, 2, 3] as const;
/** Защита от «спирали смерти»: максимум тиков за один кадр. */
export const MAX_TICKS_PER_FRAME = 30;

/** Длина игровых суток в тиках (3 минуты реального времени на 1×). */
export const DAY_TICKS = 3600;
export const DAY_START_HOUR = 6;

export const MAP_SIZE = 60;
/** Радиус стартовой зоны вокруг центра (всегда проходима, без деревьев). */
export const START_ZONE_RADIUS = 2;

/** Скорость поселенца: клеток в секунду при стоимости клетки 1. */
export const PAWN_SPEED = 3;

/** Стоимость прохода по клетке (больше = медленнее). Infinity — непроходимо. */
export const MOVE_COST = {
  grass: 1.2,
  dirt: 1.0,
  stone: Infinity,
  water: Infinity,
  tree: Infinity,
  // постройки (стена и плита непроходимы)
  door: 1.0,
  bed: 1.2,
  floor: 1.0,
} as const;

// ---------- Этап 2: поселенцы, нужды, работы ----------

export const PAWN_COUNT = 3;
export const DEFAULT_PRIORITY = 3;
/** Пауза между попытками выбрать задачу, если ничего не нашлось (тики). */
export const THINK_COOLDOWN = 20;

/** Скорость работы от навыка: 0.6 + 0.08 × уровень (навык 5 ≈ 1.0, навык 15 ≈ 1.8). */
export const SKILL_BASE_SPEED = 0.6;
export const SKILL_SPEED_PER_LEVEL = 0.08;
export const STARVING_SPEED_FACTOR = 0.5;

// Предметы
export const STACK_MAX = 50;
export const CARRY_MAX = 25;
export const DROP_SEARCH_RADIUS = 8;
export const WOOD_PER_TREE = 20;
export const STONE_PER_ROCK = 15;

// Ягодные кусты
export const BUSH_COUNT = 30;
export const BUSH_NEAR_START = 8;
export const BUSH_MAX_BERRIES = 6;
export const BUSH_REGROW_TICKS = 600;
/** Собирать ягоды, только пока всего ягод на карте меньше этого числа. */
export const BERRY_STOCK_TARGET = 40;
export const START_BERRIES = 12;
export const BERRY_FOOD = 10;

/** Длительности действий в тиках (при скорости работы 1.0). */
export const WORK_TICKS = {
  chop: 160,
  mine: 240,
  berry: 30, // на каждую ягоду
  pickup: 10,
  drop: 10,
  eat: 60,
} as const;

/** Нужды 0–100. «PerDay» — изменение за игровые сутки (DAY_TICKS тиков). */
export const NEEDS = {
  foodPerDay: 45,
  sleepPerDay: 70,
  restWorkPerDay: 150,
  restIdlePerDay: 200,
  sleepRestorePerDay: 300,
  relaxRestorePerDay: 400,
  foodUrgent: 30,
  foodCritical: 10,
  sleepUrgent: 20,
  sleepCritical: 5,
  restUrgent: 15,
  eatTarget: 95,
  sleepWake: 90,
  relaxUntil: 60,
  /** Ночью ложатся спать уже при таком уровне сна. */
  sleepNight: 55,
} as const;

// ---------- Этап 3a: строительство и огород ----------

/** Постройки: материал, количество и время работы (тики при скорости 1.0). */
export const BUILD = {
  wall: { item: 'stone', count: 2, ticks: 120 },
  door: { item: 'wood', count: 5, ticks: 100 },
  floor: { item: 'wood', count: 1, ticks: 40 },
  bed: { item: 'wood', count: 10, ticks: 150 },
  stove: { item: 'stone', count: 8, ticks: 200 },
  bench: { item: 'wood', count: 12, ticks: 180 },
} as const;

/** Разборка: доля материалов, которая возвращается, и доля времени от постройки. */
export const DECONSTRUCT = { refund: 0.5, timeFactor: 0.5 } as const;
/** Сколько тиков строитель ждёт, пока клетку под стену освободят. */
export const BUILD_WAIT_LIMIT = 400;

/** Огород: рис растёт 2 игровых дня, при сборе даёт yield штук. */
export const CROP = { growTicks: DAY_TICKS * 2, yield: 6, sowTicks: 60, reapTicks: 80 } as const;

/** Сколько еды (0–100) даёт одна единица продукта. */
export const FOOD_VALUE = { berries: 10, rice: 10, meal: 40 } as const;

// ---------- Этап 3b: комнаты, готовка, настроение ----------

/** Готовка на плите: из raw единиц сырой еды получается meals обедов. */
export const COOK = { raw: 3, meals: 2, ticks: 160, mealTarget: 10 } as const;
/** Во сколько раз быстрее восстанавливается сон в кровати. */
export const BED_SLEEP_FACTOR = 1.25;
/** Замкнутая область больше этого числа клеток — не комната (считается улицей). */
export const ROOM_MAX_CELLS = 150;

/** Настроение 0–100: база плюс сумма мыслей; ниже порога — срыв. */
export const MOOD = {
  base: 50,
  breakBelow: 20,
  /** Длительность срыва, тики (≈ 1–2 игровых часа). */
  breakMinTicks: DAY_TICKS / 24,
  breakMaxTicks: DAY_TICKS / 12,
  /** После срыва сутки без нового срыва. */
  breakCooldown: DAY_TICKS,
  wanderRadius: 5,
  wanderPauseMin: 40,
  wanderPauseMax: 100,
  /** Как часто пересчитывать настроение (тики). */
  updateEvery: 20,
} as const;

/** Прогулка праздного поселенца: короткие переходы рядом с лагерем и паузы. */
export const STROLL = { radius: 7, homeRadius: 14, pauseMin: 50, pauseMax: 200 } as const;

/** Мысли-события: значение и сколько тиков держатся. */
export const THOUGHTS = {
  ateMeal: { value: 10, ticks: DAY_TICKS },
  ateRaw: { value: -3, ticks: DAY_TICKS },
  sleptOnFloor: { value: -5, ticks: DAY_TICKS },
  sleptInBed: { value: 3, ticks: DAY_TICKS },
  ownBedroom: { value: 5, ticks: DAY_TICKS },
  catharsis: { value: 15, ticks: DAY_TICKS / 4 },
  sawCorpse: { value: -8, ticks: DAY_TICKS },
  colonistDied: { value: -10, ticks: DAY_TICKS * 2 },
} as const;

/** Мысли-состояния: действуют, пока выполняется условие по нужде. */
export const STATE_MOODS = {
  hungry: -8,
  starving: -20,
  tired: -8,
  exhausted: -5,
  cold: -6,
  freezing: -12,
  hot: -4,
  sick: -8,
  pain: -8,
} as const;

// ---------- Этап 4: время, климат, черты, события ----------

export const SEASON_DAYS = 15;
export const YEAR_DAYS = SEASON_DAYS * 4;

/** Температура °C: годовая синусоида + суточный ход + плавный шум по дням. */
export const CLIMATE = {
  mean: 9,
  amp: 18,
  /** Сдвиг фазы (в днях): старт весны ≈ 4 °C. */
  phase: 2.8,
  diurnal: 4,
  noise: 3,
  indoorBase: 16,
  indoorWeight: 0.6,
} as const;
export const COLD_WAVE = { offset: -15, days: 3 } as const;

/** Рост риса по температуре: ниже minTemp не растёт, fullTemp..hotTemp — полная скорость. */
export const GROW = { minTemp: 5, fullTemp: 20, hotTemp: 32, hotFloor: 0.5, frostKills: -3 } as const;
/** Ягодные кусты не отрастают при температуре не выше этой. */
export const BUSH_FROZEN_AT = 3;

/** Ночь: затемнение карты до maxDarkness, пик около 01:00. */
export const NIGHT = { start: 22, end: 6, maxDarkness: 0.55 } as const;

/** Влияние температуры на поселенца под открытым небом (°C). */
export const EXPOSURE = { coldBelow: 0, freezingBelow: -10, hotAbove: 32 } as const;

export const SICK = { minTicks: DAY_TICKS * 2, maxTicks: DAY_TICKS * 3, speedFactor: 0.7, sleepUrgent: 70 } as const;

/** Рассказчик: первое событие через 1.5–2.5 суток, дальше раз в 2–4 суток. */
export const STORY = {
  firstMin: Math.round(DAY_TICKS * 1.5),
  firstMax: Math.round(DAY_TICKS * 2.5),
  gapMin: DAY_TICKS * 2,
  gapMax: DAY_TICKS * 4,
  maxPawns: 6,
  strangerWait: DAY_TICKS,
  traderTicks: DAY_TICKS * 3,
  logMax: 40,
} as const;

/** Торговля: базовая цена за штуку в серебре; продаём дешевле, покупаем дороже. */
export const PRICES = { wood: 1, stone: 2, berries: 1, rice: 2, meal: 5 } as const;
export const TRADE = { sellFactor: 0.6, buyFactor: 1.5, lots: [5, 20] as readonly number[] } as const;
export const START_SILVER = 30;

// ---------- Этап 5a: здоровье, раны, лечение ----------

export const HEALTH = {
  /** Прочность частей тела: суммарный урон ранений. Голова или торс на максимуме — смерть. */
  partMax: { head: 25, torso: 40, armL: 20, armR: 20, legL: 25, legR: 25 },
  /** Кровотечение на единицу урона за тик (тупые удары кровоточат слабее — ×0.15). */
  bleedPerDamage: 0.0012,
  /** Свёртывание: множитель кровотечения за тик (без перевязки). */
  clot: 0.9995,
  /** Восстановление крови в тик, пока кровотечения нет. */
  bloodRegen: 0.01,
  /** Скорость заживления урона в тик: естественная и после перевязки (× качество). */
  healNatural: 0.0004,
  healTreated: 0.0012,
  /** Множитель заживления: на кровати / лёжа на полу. */
  bedFactor: 1.5,
  floorFactor: 1.15,
  /** Качество перевязки = 1 + навык медицины × это число. */
  qualityPerSkill: 0.06,
  painPerDamage: 1.2,
  /** Сознание ниже этого — поселенец падает; встаёт при downBelow + getUpMargin. */
  downBelow: 30,
  getUpMargin: 10,
  /** Крови меньше этого — начинается потеря сознания. */
  bloodFaintBelow: 60,
  treatTicks: 100,
  rescueLiftTicks: 30,
  rescuePlaceTicks: 20,
  buryTicks: 90,
  /** Поселенец ложится в постель, если суммарный урон не меньше этого или есть кровотечение. */
  bedrestDamage: 6,
  bedrestMaxTicks: DAY_TICKS * 3,
  /** Радиус (клеток), в котором непохороненный труп портит настроение. */
  corpseRadius: 7,
  /** Боль от которой портится настроение. */
  painMood: 30,
} as const;

// ---------- Этап 5b: набеги, бой, тревога ----------

/** Оружие: ближнее бьёт вплотную, дальнее стреляет при прямой видимости. Урон — по телу, не по очкам здоровья. */
export const WEAPONS = {
  fists: { label: 'Кулаки', melee: true, range: 1.5, cooldown: 50, min: 2, max: 4, kind: 'blunt' },
  club: { label: 'Дубина', melee: true, range: 1.5, cooldown: 40, min: 5, max: 9, kind: 'blunt' },
  bow: { label: 'Лук', melee: false, range: 9, cooldown: 70, min: 5, max: 10, kind: 'pierce' },
} as const;

export const COMBAT = {
  /** Первый набег не раньше этого дня. */
  raidFromDay: 15,
  /** Предупреждение до подхода налётчиков (20 секунд на 1×). */
  warningTicks: 400,
  repath: 15,
  meleeHit: 0.7,
  rangedBase: 0.3,
  rangedPerSkill: 0.03,
  rangedPerCell: 0.02,
  rangedMin: 0.1,
  rangedMax: 0.9,
  /** Укрытие у цели умножает шанс попадания. */
  coverFactor: 0.55,
  /** Эффект выстрела/удара на карте, тики. */
  fxTicks: 12,
  /** Налётчики бегут, когда выбыла эта доля отряда. */
  fleeFraction: 0.5,
  /** Труп налётчика лежит на карте столько тиков. */
  enemyCorpseTicks: DAY_TICKS,
  /** Навык налётчиков. */
  raiderSkillMin: 3,
  raiderSkillMax: 9,
  /** Сколько дубин лежит рядом со стартом в новой игре. */
  startClubs: 2,
  /** Вес попадания по частям тела. */
  partWeights: { torso: 40, head: 10, armL: 12, armR: 12, legL: 13, legR: 13 },
  /** Размер набега: 2 + прошлые набеги/2 + избыток колонистов, не больше 8; луки с третьего набега. */
  raidMaxSize: 8,
  equipTicks: 15,
} as const;

// ---------- Этап 5c: верстак, ремесло, лекарства ----------

/** Целебная трава: отдельная культура огорода, быстрее риса. */
export const HERB = { growTicks: Math.round(DAY_TICKS * 1.5), yield: 3, sowTicks: 60, reapTicks: 70 } as const;

/** Рецепты верстака: из count единиц input получается одна единица output. */
export const RECIPES = {
  club: { input: 'wood', count: 5, ticks: 120, output: 'club' },
  bow: { input: 'wood', count: 8, ticks: 180, output: 'bow' },
  medkit: { input: 'herb', count: 2, ticks: 100, output: 'medkit' },
} as const;

/** Что делать на верстаке само: аптечки всегда, оружие — когда пора готовиться к набегам. */
export const CRAFT = {
  medkitTarget: 4,
  weaponsFromDay: 10,
  /** Аптечка: качество перевязки умножается, время сокращается. */
  medkitQuality: 2,
  medkitTreatFactor: 0.6,
} as const;
