import { isBuildTool, type Tool } from '../input/tools';
import { BUILD, NEEDS } from '../sim/balance';
import { IMPLEMENTED_WORKS, type WorkType } from '../sim/jobs';
import type { World } from '../sim/world';
import { DAY_TICKS, TRADE, WEAPONS } from '../sim/balance';
import { calendar } from '../sim/climate';
import { acceptStranger, declineStranger, fireEvent, type EventId } from '../sim/events';
import { BODY_PARTS, consciousness, pain, bleedRate, type BodyPart, type WoundKind } from '../sim/health';
import { moodEntries } from '../sim/mood';
import { TRAITS } from '../sim/traits';
import { buy, buyPrice, canBuy, canSell, GOODS, sell, sellPrice, type Good } from '../sim/trade';
import { SKILLS, type SkillId } from '../sim/pawn';
import { ITEM_LABELS, NEED_LABELS, SKILL_LABELS, THOUGHT_LABELS, WORK_HINTS, WORK_LABELS, WORK_SHORT, jobLabel, jobProgress, moodClass } from './labels';

export interface HudCallbacks {
  onSelectPawn(id: number | null): void;
  onCenterPawn(id: number): void;
  onTool(tool: Tool | null): void;
  onPriority(pawnId: number, work: WorkType, value: number): void;
  onSave(): Promise<boolean>;
  /** Перемотка времени вперёд на столько суток (для проверки). */
  onSkip(days: number): void;
  onNewMap(): void;
}

export interface MenuItem {
  label: string;
  action: () => void;
  /** Только информация, нажать нельзя. */
  info?: boolean;
}

type Tab = 'needs' | 'skills' | 'health';
const TAB_LABELS: Record<Tab, string> = { needs: 'Нужды', skills: 'Навыки', health: 'Здоровье' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

const SIDE_ICONS: Record<string, string> = {
  Колония: 'colony',
  Работы: 'works',
  Строить: 'build',
  Приказы: 'orders',
  Ещё: 'more',
  Тревога: 'alarm',
};

/** Кнопка со значком (пиксель-арт 16×16 из Figma, public/icons) и подписью. */
function iconButton(cls: string, label: string, icon: string): HTMLButtonElement {
  const b = el('button', cls);
  const img = el('img', 'icon');
  img.src = `${import.meta.env.BASE_URL}icons/${icon}.png`;
  img.alt = '';
  img.draggable = false;
  b.append(img, el('span', 'btn__label', label));
  return b;
}

const ORDER_BUTTONS: { tool: Tool; label: string }[] = [
  { tool: 'chop', label: 'Рубить' },
  { tool: 'mine', label: 'Добывать' },
  { tool: 'zone', label: 'Склад' },
  { tool: 'erase', label: 'Стереть' },
];

const BUILD_BUTTONS: { tool: Tool; label: string }[] = [
  { tool: 'wall', label: 'Стена' },
  { tool: 'door', label: 'Дверь' },
  { tool: 'floor', label: 'Пол' },
  { tool: 'bed', label: 'Кровать' },
  { tool: 'stove', label: 'Плита' },
  { tool: 'bench', label: 'Верстак' },
  { tool: 'garden', label: 'Огород' },
  { tool: 'herbs', label: 'Травы' },
  { tool: 'deconstruct', label: 'Разобрать' },
  { tool: 'erase', label: 'Стереть' },
];

const TOOL_HINTS: Record<string, string> = {
  chop: 'Проведите по деревьям, чтобы пометить их на рубку',
  mine: 'Проведите по камню, чтобы пометить его на добычу',
  zone: 'Проведите по карте, чтобы отметить склад-зону',
  garden: 'Проведите по карте, чтобы разметить огород — там вырастет рис',
  herbs: 'Проведите по карте, чтобы разметить грядку целебных трав (из них делают аптечки)',
  deconstruct: 'Проведите по постройкам, чтобы разобрать их (вернётся половина материалов)',
  erase: 'Проведите, чтобы убрать приказы, зоны и чертежи',
  wall: 'Стена — проведите линию',
  door: 'Дверь — тап или область',
  floor: 'Пол — проведите область',
  bed: 'Кровать — тап или область',
  stove: 'Плита — тап или область',
  bench: 'Верстак — дубины, луки и аптечки',
};

function toolHint(tool: Tool): string {
  const base = TOOL_HINTS[tool] ?? '';
  if (isBuildTool(tool)) {
    const c = BUILD[tool];
    return `${base}. Нужно: ${ITEM_LABELS[c.item].toLowerCase()} ×${c.count}`;
  }
  return base;
}

const SIDE_BUTTONS = ['Колония', 'Работы', 'Строить', 'Приказы', 'Ещё', 'Тревога'] as const;
type Side = (typeof SIDE_BUTTONS)[number];

/** Все DOM-панели поверх карты: боковая панель, карточка поселенца, ресурсы, предупреждения, окна, меню. */
export class Hud {
  private selectedId: number | null = null;
  private tool: Tool | null = null;
  private bar: 'orders' | 'build' | null = null;
  private modalRender: (() => void) | null = null;
  /** Подпись содержимого: окно перерисовывается, только когда она изменилась. */
  private modalSig: (() => string) | null = null;
  private lastSig = '';
  /** Лёгкое обновление окна без пересоздания кнопок (торговля). */
  private modalTick: (() => void) | null = null;
  private shownStranger = '';
  private readonly banner = el('div', 'banner');
  private readonly gameOver = el('div', 'gameover');
  private seenLog: number;
  private readonly weather = el('span', 'resources__weather mono');
  private lastUpdate = 0;

  private readonly side = new Map<Side, HTMLButtonElement>();
  private readonly orderBar = el('div', 'orders');
  private readonly buildBar = el('div', 'orders');
  private readonly toolBtns: { tool: Tool; btn: HTMLButtonElement }[] = [];
  private readonly orderHint = el('div', 'orders__hint');
  private readonly resources = el('div', 'resources');
  private readonly resEls = new Map<string, HTMLSpanElement>();
  private readonly warnings = el('div', 'warnings');
  private readonly card = el('div', 'pawncard');
  private tab: Tab = 'needs';
  private readonly cardEls = {
    avatar: el('div', 'pawncard__avatar'),
    name: el('div', 'pawncard__name'),
    task: el('div', 'pawncard__task'),
    mood: el('div', 'pawncard__mood mono'),
    progress: el('div', 'bar bar--progress'),
    tabs: new Map<Tab, HTMLButtonElement>(),
    panels: new Map<Tab, HTMLElement>(),
    bars: new Map<string, { fill: HTMLDivElement; value: HTMLSpanElement }>(),
    skills: new Map<SkillId, { fill: HTMLDivElement; value: HTMLSpanElement }>(),
    thoughts: el('div', 'thoughts'),
    traits: el('div', 'traits'),
    health: el('div', 'healthbox'),
    weapon: el('div', 'weaponline'),
  };
  private readonly modal = el('div', 'modal');
  private readonly modalTitle = el('div', 'modal__title');
  private readonly modalBody = el('div', 'modal__body');
  private readonly menu = el('div', 'ctxmenu');
  private readonly toast = el('div', 'toast');
  private toastTimer = 0;
  private readonly portrait = window.matchMedia('(orientation: portrait)');

  constructor(
    root: HTMLElement,
    private readonly world: World,
    private readonly cb: HudCallbacks,
  ) {
    this.buildSidebar(root);
    this.buildToolbars(root);
    this.seenLog = world.logSeq;
    this.buildResources(root);
    root.append(this.warnings);
    this.buildCard(root);
    this.buildModal(root);
    this.menu.hidden = true;
    this.toast.hidden = true;
    this.banner.hidden = true;
    this.buildGameOver();
    root.append(this.menu, this.toast, this.banner, this.gameOver);
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.hideMenu();
    }, true);
    this.portrait.addEventListener('change', () => this.modalRender?.());
    this.setSelected(null);
  }

  // ---------- построение ----------

  private buildSidebar(root: HTMLElement): void {
    const bar = el('nav', 'sidebar');
    for (const label of SIDE_BUTTONS) {
      const b = iconButton('sidebar__btn', label, SIDE_ICONS[label] ?? 'more');
      b.type = 'button';
      b.addEventListener('click', () => this.onSide(label));
      bar.append(b);
      this.side.set(label, b);
    }
    root.append(bar);
  }

  private onSide(label: Side): void {
    this.hideMenu();
    if (label === 'Колония') this.openColony();
    else if (label === 'Работы') this.openWorkTable();
    else if (label === 'Строить') this.setBar(this.bar === 'build' ? null : 'build');
    else if (label === 'Приказы') this.setBar(this.bar === 'orders' ? null : 'orders');
    else if (label === 'Тревога') {
      this.world.setAlarm(!this.world.alarm);
      this.showToast(this.world.alarm ? 'Тревога: колонисты берут оружие' : 'Тревога отменена');
    }
    else this.openMore();
  }

  private buildToolbars(root: HTMLElement): void {
    const fill = (bar: HTMLElement, buttons: { tool: Tool; label: string }[]) => {
      for (const { tool, label } of buttons) {
        const b = iconButton('orders__btn', label, tool);
        b.type = 'button';
        b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
        bar.append(b);
        this.toolBtns.push({ tool, btn: b });
      }
      const close = el('button', 'orders__btn orders__close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Закрыть панель');
      close.addEventListener('click', () => this.setBar(null));
      bar.append(close);
      bar.hidden = true;
    };
    fill(this.orderBar, ORDER_BUTTONS);
    fill(this.buildBar, BUILD_BUTTONS);
    this.orderHint.hidden = true;
    root.append(this.orderBar, this.buildBar, this.orderHint);
  }

  private setBar(bar: 'orders' | 'build' | null): void {
    this.bar = bar;
    this.orderBar.hidden = bar !== 'orders';
    this.buildBar.hidden = bar !== 'build';
    document.body.classList.toggle('orders-open', bar !== null);
    this.side.get('Приказы')!.classList.toggle('active', bar === 'orders');
    this.side.get('Строить')!.classList.toggle('active', bar === 'build');
    this.setTool(null);
  }

  private setTool(tool: Tool | null): void {
    this.tool = tool;
    const bar = this.bar === 'build' ? this.buildBar : this.orderBar;
    for (const { tool: t, btn } of this.toolBtns) btn.classList.toggle('active', t === tool && bar.contains(btn));
    this.orderHint.hidden = this.bar === null;
    this.orderHint.textContent = tool ? toolHint(tool) : this.bar === null ? '' : 'Выберите, что делать';
    this.cb.onTool(tool);
  }

  private buildResources(root: HTMLElement): void {
    this.resources.append(this.weather);
    for (const kind of ['wood', 'stone', 'berries', 'rice', 'meal', 'silver', 'weapon', 'medkit'] as const) {
      const item = el('div', 'resources__item');
      item.append(el('span', `resources__dot resources__dot--${kind}`), el('span', 'resources__label', kind === 'weapon' ? 'Оружие' : ITEM_LABELS[kind]));
      const v = el('span', 'resources__value mono', '0');
      item.append(v);
      this.resEls.set(kind, v);
      this.resources.append(item);
    }
    root.append(this.resources);
  }

  private buildCard(root: HTMLElement): void {
    const c = this.cardEls;
    const head = el('div', 'pawncard__head');
    const titles = el('div', 'pawncard__titles');
    titles.append(c.name, c.task);
    const moodBox = el('div', 'pawncard__moodbox');
    moodBox.append(el('div', 'pawncard__moodlabel', 'Настроение'), c.mood);
    head.append(c.avatar, titles, moodBox);
    this.card.append(head);

    const fill = el('div', 'bar__fill');
    c.progress.append(fill);
    this.card.append(c.progress);

    const tabs = el('div', 'tabs');
    for (const t of ['needs', 'skills', 'health'] as const) {
      const b = el('button', 'tabs__btn', TAB_LABELS[t]);
      b.type = 'button';
      b.addEventListener('click', () => this.setTab(t));
      tabs.append(b);
      c.tabs.set(t, b);
    }
    this.card.append(tabs);

    const body = el('div', 'pawncard__body');
    // нужды и мысли
    const needs = el('div', 'tabpanel');
    for (const key of ['food', 'sleep', 'rest'] as const) {
      const row = el('div', 'need');
      row.append(el('span', 'need__label', NEED_LABELS[key]));
      const bar = el('div', 'bar');
      const f = el('div', 'bar__fill');
      bar.append(f);
      row.append(bar);
      const value = el('span', 'need__value mono');
      row.append(value);
      needs.append(row);
      c.bars.set(key, { fill: f, value });
    }
    needs.append(el('div', 'tabpanel__title', 'Мысли'), c.thoughts, el('div', 'tabpanel__title', 'Оружие'), c.weapon);
    c.panels.set('needs', needs);
    // навыки
    const skills = el('div', 'tabpanel');
    skills.append(c.traits);
    for (const id of SKILLS) {
      const row = el('div', 'need');
      row.append(el('span', 'need__label need__label--wide', SKILL_LABELS[id]));
      const bar = el('div', 'bar');
      const f = el('div', 'bar__fill');
      bar.append(f);
      row.append(bar);
      const value = el('span', 'need__value mono');
      row.append(value);
      skills.append(row);
      c.skills.set(id, { fill: f, value });
    }
    c.panels.set('skills', skills);
    // здоровье
    const health = el('div', 'tabpanel');
    health.append(c.health, el('div', 'modal__note', 'Раны перевязывает врач (работа «Лечение»); пока ему нечем лечить, кроме бинтов.'));
    c.panels.set('health', health);
    for (const panel of c.panels.values()) body.append(panel);
    this.card.append(body);

    const actions = el('div', 'pawncard__actions');
    const works = el('button', 'btn', 'Работы');
    works.type = 'button';
    works.addEventListener('click', () => this.openWorkTable());
    const center = el('button', 'btn', 'Найти');
    center.type = 'button';
    center.addEventListener('click', () => this.selectedId !== null && this.cb.onCenterPawn(this.selectedId));
    actions.append(center, works);
    this.card.append(actions);
    root.append(this.card);
    this.setTab('needs');
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    for (const [t, b] of this.cardEls.tabs) b.classList.toggle('active', t === tab);
    for (const [t, p] of this.cardEls.panels) p.hidden = t !== tab;
  }

  private buildModal(root: HTMLElement): void {
    const panel = el('div', 'modal__panel');
    const head = el('div', 'modal__head');
    const close = el('button', 'btn modal__close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть');
    close.addEventListener('click', () => this.closeModal());
    head.append(this.modalTitle, close);
    panel.append(head, this.modalBody);
    this.modal.append(panel);
    this.modal.hidden = true;
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    root.append(this.modal);
  }

  // ---------- окна ----------

  private open(title: string, render: (body: HTMLElement) => void, sig?: () => string): void {
    this.modalRender = () => {
      this.modalBody.replaceChildren();
      render(this.modalBody);
    };
    this.modalSig = sig ?? null;
    this.lastSig = sig ? sig() : '';
    this.modalTick = null;
    setText(this.modalTitle, title);
    this.modalRender();
    this.modal.hidden = false;
  }

  closeModal(): void {
    this.modal.hidden = true;
    this.modalRender = null;
    this.modalSig = null;
    this.modalTick = null;
  }

  private openColony(): void {
    const sig = () =>
      this.world.pawns
        .map((p) => `${p.dead ? (p.buried ? 'B' : 'D') : ''}${p.name}${jobLabel(p)}${Math.round(p.mood)}${Math.round(p.needs.food)}${Math.round(p.needs.sleep)}${Math.round(p.needs.rest)}`)
        .join('|') + `#${this.world.logSeq}${this.world.story.pending ? 'p' : ''}${this.world.traderPresent ? 't' : ''}`;
    this.open('Колония', (body) => {
      const story = this.world.story;
      if (story.pending) {
        const b = el('button', 'btn btn--wide btn--event', `Странник ${story.pending.pawn.name} ждёт решения`);
        b.type = 'button';
        b.addEventListener('click', () => this.openStranger());
        body.append(b);
      }
      if (this.world.traderPresent) {
        const days = Math.max(0, (story.trader!.until - this.world.tickCount) / DAY_TICKS);
        const b = el('button', 'btn btn--wide btn--event', `Торговец (ещё ${days.toFixed(1)} сут.) — торговать`);
        b.type = 'button';
        b.addEventListener('click', () => this.openTrade());
        body.append(b);
      }
      for (const p of this.world.pawns.filter((q) => q.dead)) {
        const row = el('div', 'colonyrow colonyrow--dead');
        const av = el('span', 'avatar avatar--dead', '†');
        const info = el('span', 'colonyrow__info');
        info.append(el('span', 'colonyrow__name', p.name), el('span', 'colonyrow__task', p.buried ? 'Похоронен' : 'Погиб, не похоронен'));
        row.append(av, info);
        body.append(row);
      }
      for (const p of this.world.living) {
        const row = el('button', 'colonyrow');
        row.type = 'button';
        const av = el('span', 'avatar', p.name.charAt(0));
        av.style.setProperty('--pawn', p.color);
        const info = el('span', 'colonyrow__info');
        info.append(el('span', 'colonyrow__name', p.name), el('span', 'colonyrow__task', jobLabel(p)));
        const n = p.needs;
        const nums = el('span', 'colonyrow__needs mono', `${Math.round(n.food)} · ${Math.round(n.sleep)} · ${Math.round(n.rest)}`);
        const mood = el('span', `colonyrow__mood mono mood--${moodClass(p.mood)}`, `${Math.round(p.mood)}%`);
        row.append(av, info, nums, mood);
        row.addEventListener('click', () => {
          this.closeModal();
          this.cb.onSelectPawn(p.id);
          this.cb.onCenterPawn(p.id);
        });
        body.append(row);
      }
      body.append(el('div', 'modal__note', 'Числа: еда · сон · отдых, затем настроение'));
      body.append(el('div', 'tabpanel__title', 'Журнал'));
      const log = el('div', 'journal');
      const entries = this.world.log.slice(-12).reverse();
      if (entries.length === 0) log.append(el('div', 'journal__row journal__row--none', 'Пока ничего не происходило'));
      for (const e of entries) {
        const row = el('div', 'journal__row');
        const t = calendar(e.tick);
        row.append(el('span', 'journal__time mono', `${t.seasonName.slice(0, 3)} ${t.dayInSeason}`), el('span', '', e.text));
        log.append(row);
      }
      body.append(log);
    }, sig);
  }

  /** Диалог странника: характеристики и решение принять или отказать. */
  private openStranger(): void {
    const pending = this.world.story.pending;
    if (!pending) return;
    const p = pending.pawn;
    this.open('Странник', (body) => {
      const head = el('div', 'stranger__head');
      const av = el('span', 'avatar', p.name.charAt(0));
      av.style.setProperty('--pawn', p.color);
      const t = el('div');
      const left = Math.max(0, (pending.until - this.world.tickCount) / DAY_TICKS);
      t.append(el('div', 'stranger__name', p.name), el('div', 'modal__note stranger__note', `Просит принять в колонию. Ответить нужно за ${Math.max(1, Math.round(left * 24))} ч.`));
      head.append(av, t);
      body.append(head);

      body.append(el('div', 'tabpanel__title', 'Черты'));
      for (const id of p.traits) {
        const row = el('div', 'trait');
        row.append(el('div', 'trait__label', TRAITS[id].label), el('div', 'trait__desc', TRAITS[id].desc));
        body.append(row);
      }
      body.append(el('div', 'tabpanel__title', 'Навыки'));
      const grid = el('div', 'skillgrid');
      for (const id of SKILLS) {
        const row = el('div', 'skillgrid__row');
        row.append(el('span', '', SKILL_LABELS[id]));
        const bar = el('div', 'bar');
        const f = el('div', 'bar__fill');
        f.style.width = `${(p.skills[id] / 20) * 100}%`;
        bar.append(f);
        row.append(bar, el('span', 'mono', String(p.skills[id])));
        grid.append(row);
      }
      body.append(grid);

      const actions = el('div', 'pawncard__actions stranger__actions');
      const no = el('button', 'btn', 'Отказать');
      no.type = 'button';
      no.addEventListener('click', () => {
        declineStranger(this.world);
        this.closeModal();
      });
      const yes = el('button', 'btn btn--accent', 'Принять');
      yes.type = 'button';
      yes.addEventListener('click', () => {
        const name = p.name;
        if (acceptStranger(this.world)) this.showToast(`${name} теперь в колонии`);
        this.closeModal();
      });
      actions.append(no, yes);
      body.append(actions);
    });
  }

  /** Торговля с торговцем: серебро и товары на складе. Кнопки не пересоздаются, только обновляются. */
  private openTrade(): void {
    if (!this.world.traderPresent) return;
    this.open('Торговец', (body) => {
      const info = el('div', 'trade__info mono');
      body.append(info);
      const refreshers: (() => void)[] = [];
      for (const good of GOODS) {
        const row = el('div', 'trade__row');
        const title = el('div', 'trade__title');
        const stock = el('span', 'mono trade__stock');
        title.append(el('span', '', ITEM_LABELS[good]), stock);
        row.append(title);
        const btns = el('div', 'trade__btns');
        const mk = (kind: 'sell' | 'buy', lot: number) => {
          const b = el('button', `btn trade__btn trade__btn--${kind}`);
          b.type = 'button';
          b.addEventListener('click', () => {
            if (kind === 'sell') sell(this.world, good, lot);
            else buy(this.world, good, lot);
            this.refreshTrade();
          });
          btns.append(b);
          refreshers.push(() => {
            const price = kind === 'sell' ? sellPrice(good, lot) : buyPrice(good, lot);
            setText(b, kind === 'sell' ? `Продать ${lot} · +${price}` : `Купить ${lot} · −${price}`);
            b.disabled = kind === 'sell' ? !canSell(this.world, good, lot) : !canBuy(this.world, good, lot);
          });
        };
        for (const lot of TRADE.lots) mk('sell', lot);
        for (const lot of TRADE.lots) mk('buy', lot);
        row.append(btns);
        body.append(row);
        refreshers.push(() => setText(stock, `на складе: ${this.world.stockpile()[good as Good]}`));
      }
      body.append(el('div', 'modal__note', 'Торговля идёт через склад-зону: товар берётся и кладётся туда. Нужна склад-зона с местом.'));
      this.tradeRefresh = () => {
        const left = this.world.story.trader ? Math.max(0, (this.world.story.trader.until - this.world.tickCount) / DAY_TICKS) : 0;
        setText(info, `Серебро: ${this.world.stockpile().silver} · торговец ещё ${left.toFixed(1)} сут.`);
        for (const r of refreshers) r();
      };
      this.tradeRefresh();
    });
    this.modalTick = () => {
      if (!this.world.traderPresent) {
        this.closeModal();
        this.showToast('Торговец ушёл');
        return;
      }
      this.tradeRefresh?.();
    };
  }

  private tradeRefresh: (() => void) | null = null;

  private refreshTrade(): void {
    this.tradeRefresh?.();
  }

  private openWorkTable(): void {
    this.open('Работы', (body) => {
      const pawns = this.world.living;
      const works = IMPLEMENTED_WORKS;
      const portrait = this.portrait.matches;
      const table = el('table', portrait ? 'worktable' : 'worktable worktable--dense');

      const cell = (pawnId: number, work: WorkType): HTMLTableCellElement => {
        const td = el('td');
        const b = el('button', 'prio');
        b.type = 'button';
        const paint = () => {
          const v = this.world.pawns[pawnId]!.priorities[work];
          b.textContent = v === 0 ? '—' : String(v);
          b.className = `prio prio--${v}`;
          b.setAttribute('aria-label', `${this.world.pawns[pawnId]!.name}: ${WORK_LABELS[work]}, ${v === 0 ? 'выключено' : 'приоритет ' + v}`);
        };
        paint();
        b.addEventListener('click', () => {
          // 1 → 2 → 3 → 4 → выкл → 1
          const cur = this.world.pawns[pawnId]!.priorities[work];
          this.cb.onPriority(pawnId, work, cur === 0 ? 1 : cur === 4 ? 0 : cur + 1);
          paint();
        });
        td.append(b);
        return td;
      };
      const pawnHead = (id: number): HTMLTableCellElement => {
        const p = this.world.pawns[id]!;
        const th = el('th');
        const av = el('span', 'avatar avatar--small', p.name.charAt(0));
        av.style.setProperty('--pawn', p.color);
        th.append(av, el('span', 'worktable__name', p.name));
        return th;
      };
      const workHead = (w: WorkType): HTMLTableCellElement => {
        const th = el('th');
        th.append(el('span', 'worktable__work', WORK_SHORT[w]));
        const hint = WORK_HINTS[w];
        th.title = hint ? `${WORK_LABELS[w]}: ${hint}` : WORK_LABELS[w];
        return th;
      };

      if (!portrait) {
        // горизонтально: поселенцы — строки, работы — столбцы
        const tr = el('tr');
        tr.append(el('th'));
        for (const w of works) tr.append(workHead(w));
        table.append(tr);
        for (const p of pawns) {
          const r = el('tr');
          r.append(pawnHead(p.id));
          for (const w of works) r.append(cell(p.id, w));
          table.append(r);
        }
      } else {
        // вертикально транспонировано: работы — строки, поселенцы — столбцы
        const tr = el('tr');
        tr.append(el('th'));
        for (const p of pawns) tr.append(pawnHead(p.id));
        table.append(tr);
        for (const w of works) {
          const r = el('tr');
          r.append(workHead(w));
          for (const p of pawns) r.append(cell(p.id, w));
          table.append(r);
        }
      }
      body.append(table);
      body.append(el('div', 'modal__note', '1 — делает в первую очередь, 4 — в последнюю, «—» — не делает. Нажмите, чтобы изменить.'));
    });
  }

  private openMore(): void {
    this.open('Ещё', (body) => {
      body.append(el('div', 'modal__note', `Сид карты: ${this.world.seed}. Игра сохраняется сама: раз в сутки и при сворачивании.`));

      const save = el('button', 'btn btn--wide', 'Сохранить сейчас');
      save.type = 'button';
      save.addEventListener('click', () => {
        void this.cb.onSave().then((ok) => this.showToast(ok ? 'Сохранено' : 'Не удалось сохранить'));
      });
      body.append(save);

      const fresh = el('button', 'btn btn--wide btn--gap', 'Новая карта');
      fresh.type = 'button';
      const confirm = el('div', 'confirm');
      confirm.hidden = true;
      confirm.append(el('div', 'modal__note', 'Текущая колония будет удалена. Начать заново?'));
      const row = el('div', 'pawncard__actions');
      const no = el('button', 'btn', 'Отмена');
      no.type = 'button';
      no.addEventListener('click', () => {
        confirm.hidden = true;
        fresh.hidden = false;
      });
      const yes = el('button', 'btn btn--danger', 'Начать заново');
      yes.type = 'button';
      yes.addEventListener('click', () => this.cb.onNewMap());
      row.append(no, yes);
      confirm.append(row);
      fresh.addEventListener('click', () => {
        fresh.hidden = true;
        confirm.hidden = false;
      });
      body.append(fresh, confirm);

      // инструменты проверки: перемотка времени, события и ранения
      body.append(el('div', 'tabpanel__title', 'Проверка'));
      const group = (title: string, items: [string, () => void][]) => {
        body.append(el('div', 'modal__note', title));
        const row = el('div', 'dbg');
        for (const [label, fn] of items) {
          const b = el('button', 'btn dbg__btn', label);
          b.type = 'button';
          b.addEventListener('click', fn);
          row.append(b);
        }
        body.append(row);
      };
      group('Перемотка времени вперёд', [
        ['+1 сутки', () => this.skip(1)],
        ['+3 суток', () => this.skip(3)],
        ['+7 суток', () => this.skip(7)],
      ]);
      const ev = (id: EventId, name: string): [string, () => void] => [
        name,
        () => this.showToast(fireEvent(this.world, id) ? `Событие: ${name}` : `Сейчас нельзя: ${name}`),
      ];
      group('Вызвать событие', [ev('stranger', 'Странник'), ev('trader', 'Торговец'), ev('illness', 'Болезнь'), ev('coldWave', 'Холодная волна'), ev('raid', 'Набег')]);
      const peace = el('button', 'btn btn--wide btn--gap', '');
      peace.type = 'button';
      const paintPeace = () => setText(peace, this.world.story.peaceful ? 'Мирный режим: включён (набегов нет)' : 'Мирный режим: выключен');
      peace.addEventListener('click', () => {
        this.world.story.peaceful = !this.world.story.peaceful;
        paintPeace();
      });
      paintPeace();
      body.append(peace);
      const hurt = (label: string, wounds: [BodyPart, WoundKind, number][]): [string, () => void] => [
        label,
        () => {
          const id = this.selectedId;
          if (id === null) return this.showToast('Сначала выберите поселенца');
          for (const [part, kind, dmg] of wounds) this.world.injure(id, part, kind, dmg);
          this.showToast(`${label}: ${this.world.pawns[id]!.name}`);
        },
      ];
      group('Ранить выбранного поселенца', [
        hurt('Лёгкая', [['legL', 'cut', 5], ['armR', 'blunt', 3]]),
        hurt('Тяжёлая', [['torso', 'cut', 14], ['legL', 'cut', 14], ['legR', 'blunt', 10]]),
        hurt('Смертельная', [['torso', 'pierce', 45]]),
      ]);
    });
  }

  private skip(days: number): void {
    this.closeModal();
    this.cb.onSkip(days);
  }

  // ---------- меню и сообщения ----------

  showMenu(x: number, y: number, items: readonly MenuItem[]): void {
    if (items.length === 0) return;
    this.menu.replaceChildren();
    for (const it of items) {
      const b = el('button', it.info ? 'ctxmenu__item ctxmenu__item--info' : 'ctxmenu__item', it.label);
      b.type = 'button';
      b.disabled = !!it.info;
      b.addEventListener('click', () => {
        this.hideMenu();
        it.action();
      });
      this.menu.append(b);
    }
    this.menu.hidden = false;
    const w = this.menu.offsetWidth;
    const h = this.menu.offsetHeight;
    this.menu.style.left = `${Math.max(7, Math.min(x, window.innerWidth - w - 7))}px`;
    this.menu.style.top = `${Math.max(50, Math.min(y, window.innerHeight - h - 7))}px`;
  }

  hideMenu(): void {
    this.menu.hidden = true;
  }

  showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 2200);
  }

  // ---------- состояние ----------

  setSelected(id: number | null): void {
    this.selectedId = id;
    this.card.hidden = id === null;
    document.body.classList.toggle('has-card', id !== null);
    this.lastUpdate = 0;
  }

  /** Вызывать каждый кадр; тяжёлая часть обновляется ~10 раз в секунду. */
  update(now: number): void {
    if (now - this.lastUpdate < 100) return;
    this.lastUpdate = now;

    const stock = this.world.stockpile();
    setText(this.resEls.get('wood')!, String(stock.wood));
    setText(this.resEls.get('stone')!, String(stock.stone));
    setText(this.resEls.get('berries')!, String(stock.berries));
    setText(this.resEls.get('rice')!, String(stock.rice));
    setText(this.resEls.get('meal')!, String(stock.meal));
    setText(this.resEls.get('silver')!, String(stock.silver));
    setText(this.resEls.get('weapon')!, String(stock.club + stock.bow));
    setText(this.resEls.get('medkit')!, String(stock.medkit));
    this.side.get('Тревога')!.classList.toggle('active', this.world.alarm);
    this.updateWeather();
    this.updateEvents();

    this.updateWarnings();
    this.gameOver.hidden = !this.world.lost;

    const p = this.selectedId === null ? null : this.world.pawns[this.selectedId];
    if (p) {
      const c = this.cardEls;
      setText(c.name, p.name);
      c.avatar.textContent = p.name.charAt(0);
      c.avatar.style.setProperty('--pawn', p.color);
      setText(c.task, jobLabel(p));
      setText(c.mood, `${Math.round(p.mood)}%`);
      c.mood.className = `pawncard__mood mono mood--${moodClass(p.mood)}`;
      const prog = jobProgress(this.world, p);
      c.progress.hidden = prog === null;
      if (prog !== null) (c.progress.firstElementChild as HTMLElement).style.width = `${Math.round(prog * 100)}%`;
      this.updateTraitsAndHealth(p);
      if (this.tab === 'needs') {
        for (const key of ['food', 'sleep', 'rest'] as const) {
          const v = p.needs[key];
          const b = c.bars.get(key)!;
          b.fill.style.width = `${Math.round(v)}%`;
          b.fill.className = `bar__fill ${v < 25 ? 'bad' : v < 50 ? 'warn' : 'good'}`;
          setText(b.value, String(Math.round(v)));
        }
        this.updateThoughts(p);
        setText(c.weapon, p.weapon ? WEAPONS[p.weapon].label : 'Нет — бьёт кулаками');
      } else if (this.tab === 'skills') {
        for (const [id, b] of c.skills) {
          const v = p.skills[id];
          b.fill.style.width = `${Math.round((v / 20) * 100)}%`;
          setText(b.value, String(v));
        }
      }
    }
    if (!this.modal.hidden) {
      if (this.modalSig) {
        const s = this.modalSig();
        if (s !== this.lastSig) {
          this.lastSig = s;
          this.modalRender?.();
        }
      }
      this.modalTick?.();
    }
  }

  /** Три главные мысли по модулю значения. */
  private updateThoughts(p: (typeof this.world.pawns)[number]): void {
    const top = moodEntries(p, this.world.tickCount)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
    const key = top.map((e) => `${e.key}:${e.value}`).join('|');
    const box = this.cardEls.thoughts;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    if (top.length === 0) {
      box.replaceChildren(el('div', 'thought thought--none', 'Ничего особенного'));
      return;
    }
    box.replaceChildren(
      ...top.map((e) => {
        const row = el('div', `thought thought--${e.value >= 0 ? 'good' : 'bad'}`);
        row.append(el('span', '', THOUGHT_LABELS[e.key]), el('span', 'mono', `${e.value > 0 ? '+' : ''}${e.value}`));
        return row;
      }),
    );
  }

  /** Открыта ли панель «Строить» (на карте подсвечиваются комнаты). */
  get buildOpen(): boolean {
    return this.bar === 'build';
  }

  private updateWeather(): void {
    const t = this.world.outdoorTemp();
    const cal = calendar(this.world.tickCount);
    setText(this.weather, `${cal.seasonName}, ${Math.round(t)}°`);
    this.weather.className = `resources__weather mono ${t < 0 ? 'weather--cold' : t > 30 ? 'weather--hot' : ''}`;
  }

  /** Тосты о новых записях журнала и автоматическое окно странника. */
  private updateEvents(): void {
    if (this.world.logSeq !== this.seenLog) {
      const last = this.world.log[this.world.log.length - 1];
      this.seenLog = this.world.logSeq;
      if (last) this.showToast(last.text);
    }
    const pending = this.world.story.pending;
    if (!pending) {
      this.shownStranger = '';
    } else {
      const key = `${pending.pawn.name}${pending.until}`;
      if (key !== this.shownStranger && this.modal.hidden) {
        this.shownStranger = key;
        this.openStranger();
      }
    }
  }

  /** Черты и здоровье выбранного поселенца. */
  private updateTraitsAndHealth(p: (typeof this.world.pawns)[number]): void {
    const c = this.cardEls;
    const key = `${p.id}:${p.traits.join(',')}`;
    if (c.traits.dataset.key !== key) {
      c.traits.dataset.key = key;
      c.traits.replaceChildren(
        el('div', 'tabpanel__title', 'Черты'),
        ...p.traits.map((id) => {
          const row = el('div', 'trait');
          row.append(el('div', 'trait__label', TRAITS[id].label), el('div', 'trait__desc', TRAITS[id].desc));
          return row;
        }),
        el('div', 'tabpanel__title', 'Навыки'),
      );
    }
    const tick = this.world.tickCount;
    const hKey = [
      p.dead, p.downed, Math.round(p.blood / 4), p.sickUntil > tick ? Math.floor((p.sickUntil - tick) / 360) : -1,
      p.wounds.map((w) => `${w.part}${w.kind}${Math.round(w.damage * 2)}${w.treated ? 1 : 0}${w.bleed > 0.0005 ? 1 : 0}`).join(','),
    ].join('|');
    if (c.health.dataset.key !== hKey) {
      c.health.dataset.key = hKey;
      c.health.replaceChildren(...this.buildHealth(p));
    }
  }

  private vitalRow(label: string, value: number, goodHigh: boolean): HTMLElement {
    const row = el('div', 'need');
    row.append(el('span', 'need__label', label));
    const bar = el('div', 'bar');
    const f = el('div', `bar__fill ${(goodHigh ? value : 100 - value) < 35 ? 'bad' : (goodHigh ? value : 100 - value) < 65 ? 'warn' : 'good'}`);
    f.style.width = `${Math.round(value)}%`;
    bar.append(f);
    row.append(bar, el('span', 'need__value mono', String(Math.round(value))));
    return row;
  }

  /** Содержимое вкладки «Здоровье»: общее состояние, показатели и раны по частям тела. */
  private buildHealth(p: (typeof this.world.pawns)[number]): HTMLElement[] {
    const out: HTMLElement[] = [];
    const tick = this.world.tickCount;
    const sick = p.sickUntil > tick;
    if (p.dead) {
      out.push(el('div', 'healthbox__dead', p.buried ? 'Погиб и похоронен' : 'Погиб'));
      return out;
    }
    const wounded = p.wounds.length > 0;
    out.push(el('div', p.downed ? 'healthbox__dead' : wounded || sick ? 'healthbox__sick' : 'healthbox__ok', p.downed ? 'Без сознания' : wounded ? 'Ранен' : sick ? 'Болеет' : 'Здоров'));
    if (wounded || p.blood < 100) {
      out.push(this.vitalRow('Кровь', p.blood, true), this.vitalRow('Боль', pain(p), false), this.vitalRow('Сознание', consciousness(p), true));
    }
    if (sick) out.push(el('div', 'healthbox__sick', `Простуда: ещё ${((p.sickUntil - tick) / DAY_TICKS).toFixed(1)} сут. Работает медленнее и чаще хочет спать.`));
    const PART: Record<BodyPart, string> = {
      head: 'Голова', torso: 'Торс', armL: 'Левая рука', armR: 'Правая рука', legL: 'Левая нога', legR: 'Правая нога',
    };
    const KIND: Record<WoundKind, string> = { cut: 'порез', blunt: 'ушиб', pierce: 'прокол' };
    for (const part of BODY_PARTS) {
      const ws = p.wounds.filter((w) => w.part === part);
      if (ws.length === 0) continue;
      const box = el('div', 'wound');
      box.append(el('div', 'wound__part', PART[part]));
      for (const w of ws) {
        const state = w.treated ? 'перевязана' : w.bleed > 0.0005 ? 'кровоточит' : 'не перевязана';
        const row = el('div', `wound__row wound__row--${w.treated ? 'ok' : w.bleed > 0.0005 ? 'bad' : 'warn'}`);
        row.append(el('span', '', `${KIND[w.kind][0]!.toUpperCase()}${KIND[w.kind].slice(1)} ${w.damage.toFixed(1)}`), el('span', '', state));
        box.append(row);
      }
      out.push(box);
    }
    if (!wounded && !sick) out.push(el('div', 'modal__note', 'Ран нет.'));
    return out;
  }

  /** Постоянная надпись сверху (идёт перемотка времени). */
  setBanner(text: string | null): void {
    this.banner.hidden = text === null;
    if (text !== null) setText(this.banner, text);
  }

  private buildGameOver(): void {
    this.gameOver.hidden = true;
    const box = el('div', 'gameover__box');
    box.append(el('div', 'gameover__title', 'Колония погибла'), el('div', 'modal__note', 'Все поселенцы мертвы. Можно начать заново на новой карте.'));
    const b = el('button', 'btn btn--accent btn--wide', 'Новая карта');
    b.type = 'button';
    b.addEventListener('click', () => this.cb.onNewMap());
    box.append(b);
    this.gameOver.append(box);
  }

  private updateWarnings(): void {
    type Chip = { text: string; level: 'bad' | 'warn' | 'good'; action?: () => void };
    const chips: Chip[] = [];
    const tick = this.world.tickCount;
    if (this.world.story.pending) chips.push({ text: `Странник ${this.world.story.pending.pawn.name} просит приюта`, level: 'good', action: () => this.openStranger() });
    if (this.world.traderPresent) chips.push({ text: 'Прибыл торговец', level: 'good', action: () => this.openTrade() });
    if (this.world.story.coldWaveUntil > tick) chips.push({ text: 'Холодная волна', level: 'warn' });
    if (this.world.story.raid) {
      const sec = Math.max(0, Math.ceil((this.world.story.raid.at - tick) / 20));
      chips.push({ text: `Набег через ${sec} с: ${this.world.story.raid.count} чел.`, level: 'bad' });
    }
    const foes = this.world.enemies.filter((e) => !e.dead && !e.downed).length;
    if (foes > 0) chips.push({ text: `Налётчики: ${foes}`, level: 'bad' });
    for (const p of this.world.living) {
      if (p.needs.food <= 0) chips.push({ text: `${p.name} голодает`, level: 'bad' });
      else if (p.needs.food < NEEDS.foodUrgent) chips.push({ text: `${p.name} голоден`, level: 'warn' });
      if (p.needs.sleep <= NEEDS.sleepCritical) chips.push({ text: `${p.name} валится с ног`, level: 'bad' });
      if (p.breakUntil !== null) chips.push({ text: `${p.name} в срыве`, level: 'bad' });
      else if (p.mood < 30) chips.push({ text: `${p.name} на грани срыва`, level: 'warn' });
      if (p.sickUntil > tick) chips.push({ text: `${p.name} болеет`, level: 'warn' });
      if (p.downed) chips.push({ text: `${p.name} без сознания`, level: 'bad' });
      else if (bleedRate(p) > 0.003) chips.push({ text: `${p.name} истекает кровью`, level: 'bad' });
      else if (p.wounds.some((w) => !w.treated)) chips.push({ text: `${p.name} ранен`, level: 'warn' });
      if (p.exposure === 'cold' || p.exposure === 'freezing') chips.push({ text: `${p.name} мёрзнет`, level: p.exposure === 'freezing' ? 'bad' : 'warn' });
      else if (p.exposure === 'hot') chips.push({ text: `${p.name}: жара`, level: 'warn' });
    }
    if (this.world.needsZone) chips.push({ text: 'Нет склад-зоны', level: 'warn' });
    // чтобы чипы не закрывали карту: самые важные сверху, остальные сворачиваем в «ещё N»
    const rank = { bad: 0, good: 1, warn: 2 } as const;
    chips.sort((a, b) => rank[a.level] - rank[b.level]);
    const MAX = 4;
    const shown = chips.slice(0, MAX);
    const more = chips.length - shown.length;
    const key = shown.map((c) => c.level + c.text).join('|') + more;
    if (this.warnings.dataset.key === key) return;
    this.warnings.dataset.key = key;
    this.warnings.replaceChildren(
      ...shown.map((c) => {
        if (!c.action) return el('span', `chip chip--${c.level}`, c.text);
        const b = el('button', `chip chip--${c.level} chip--action`, c.text);
        b.type = 'button';
        b.addEventListener('click', c.action);
        return b;
      }),
      ...(more > 0 ? [el('span', 'chip', `и ещё ${more}`)] : []),
    );
  }
}
