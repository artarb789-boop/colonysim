import { isBuildTool, type Tool } from '../input/tools';
import { BUILD, NEEDS } from '../sim/balance';
import { IMPLEMENTED_WORKS, type WorkType } from '../sim/jobs';
import type { World } from '../sim/world';
import { moodEntries } from '../sim/mood';
import { SKILLS, type SkillId } from '../sim/pawn';
import { ITEM_LABELS, NEED_LABELS, SKILL_LABELS, THOUGHT_LABELS, WORK_HINTS, WORK_LABELS, jobLabel, jobProgress, moodClass } from './labels';

export interface HudCallbacks {
  onSelectPawn(id: number | null): void;
  onCenterPawn(id: number): void;
  onTool(tool: Tool | null): void;
  onPriority(pawnId: number, work: WorkType, value: number): void;
  onSave(): Promise<boolean>;
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
  { tool: 'garden', label: 'Огород' },
  { tool: 'deconstruct', label: 'Разобрать' },
  { tool: 'erase', label: 'Стереть' },
];

const TOOL_HINTS: Record<string, string> = {
  chop: 'Проведите по деревьям, чтобы пометить их на рубку',
  mine: 'Проведите по камню, чтобы пометить его на добычу',
  zone: 'Проведите по карте, чтобы отметить склад-зону',
  garden: 'Проведите по карте, чтобы разметить огород — там вырастет рис',
  deconstruct: 'Проведите по постройкам, чтобы разобрать их (вернётся половина материалов)',
  erase: 'Проведите, чтобы убрать приказы, зоны и чертежи',
  wall: 'Стена — проведите линию',
  door: 'Дверь — тап или область',
  floor: 'Пол — проведите область',
  bed: 'Кровать — тап или область',
  stove: 'Плита — тап или область',
};

function toolHint(tool: Tool): string {
  const base = TOOL_HINTS[tool] ?? '';
  if (isBuildTool(tool)) {
    const c = BUILD[tool];
    return `${base}. Нужно: ${ITEM_LABELS[c.item].toLowerCase()} ×${c.count}`;
  }
  return base;
}

const SIDE_BUTTONS = ['Колония', 'Работы', 'Строить', 'Приказы', 'Ещё'] as const;
type Side = (typeof SIDE_BUTTONS)[number];

/** Все DOM-панели поверх карты: боковая панель, карточка поселенца, ресурсы, предупреждения, окна, меню. */
export class Hud {
  private selectedId: number | null = null;
  private tool: Tool | null = null;
  private bar: 'orders' | 'build' | null = null;
  private modalRender: (() => void) | null = null;
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
    this.buildResources(root);
    root.append(this.warnings);
    this.buildCard(root);
    this.buildModal(root);
    this.menu.hidden = true;
    this.toast.hidden = true;
    root.append(this.menu, this.toast);
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
      const b = el('button', 'sidebar__btn', label);
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
    else this.openMore();
  }

  private buildToolbars(root: HTMLElement): void {
    const fill = (bar: HTMLElement, buttons: { tool: Tool; label: string }[]) => {
      for (const { tool, label } of buttons) {
        const b = el('button', 'orders__btn', label);
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
    for (const kind of ['wood', 'stone', 'berries', 'rice', 'meal'] as const) {
      const item = el('div', 'resources__item');
      item.append(el('span', `resources__dot resources__dot--${kind}`), el('span', 'resources__label', ITEM_LABELS[kind]));
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
    needs.append(el('div', 'tabpanel__title', 'Мысли'), c.thoughts);
    c.panels.set('needs', needs);
    // навыки
    const skills = el('div', 'tabpanel');
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
    health.append(el('div', 'tabpanel__title', 'Здоров'), el('div', 'modal__note', 'Ранения и болезни появятся в следующих этапах.'));
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

  private open(title: string, render: (body: HTMLElement) => void): void {
    this.modalRender = () => {
      this.modalBody.replaceChildren();
      render(this.modalBody);
    };
    setText(this.modalTitle, title);
    this.modalRender();
    this.modal.hidden = false;
  }

  closeModal(): void {
    this.modal.hidden = true;
    this.modalRender = null;
  }

  private openColony(): void {
    this.open('Колония', (body) => {
      for (const p of this.world.pawns) {
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
    });
  }

  private openWorkTable(): void {
    this.open('Работы', (body) => {
      const pawns = this.world.pawns;
      const works = IMPLEMENTED_WORKS;
      const portrait = this.portrait.matches;
      const table = el('table', 'worktable');

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
        th.append(el('span', 'worktable__work', WORK_LABELS[w]));
        const hint = WORK_HINTS[w];
        if (hint) th.append(el('span', 'worktable__hint', hint));
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
    });
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
    this.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
    this.menu.style.top = `${Math.max(56, Math.min(y, window.innerHeight - h - 8))}px`;
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

    this.updateWarnings();

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
      if (this.tab === 'needs') {
        for (const key of ['food', 'sleep', 'rest'] as const) {
          const v = p.needs[key];
          const b = c.bars.get(key)!;
          b.fill.style.width = `${Math.round(v)}%`;
          b.fill.className = `bar__fill ${v < 25 ? 'bad' : v < 50 ? 'warn' : 'good'}`;
          setText(b.value, String(Math.round(v)));
        }
        this.updateThoughts(p);
      } else if (this.tab === 'skills') {
        for (const [id, b] of c.skills) {
          const v = p.skills[id];
          b.fill.style.width = `${Math.round((v / 20) * 100)}%`;
          setText(b.value, String(v));
        }
      }
    }
    if (!this.modal.hidden && this.modalTitle.textContent === 'Колония') this.modalRender?.();
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

  private updateWarnings(): void {
    const chips: { text: string; level: 'bad' | 'warn' }[] = [];
    for (const p of this.world.pawns) {
      if (p.needs.food <= 0) chips.push({ text: `${p.name} голодает`, level: 'bad' });
      else if (p.needs.food < NEEDS.foodUrgent) chips.push({ text: `${p.name} голоден`, level: 'warn' });
      if (p.needs.sleep <= NEEDS.sleepCritical) chips.push({ text: `${p.name} валится с ног`, level: 'bad' });
      if (p.breakUntil !== null) chips.push({ text: `${p.name} в срыве`, level: 'bad' });
      else if (p.mood < 30) chips.push({ text: `${p.name} на грани срыва`, level: 'warn' });
    }
    if (this.world.needsZone) chips.push({ text: 'Нет склад-зоны', level: 'warn' });
    const key = chips.map((c) => c.level + c.text).join('|');
    if (this.warnings.dataset.key === key) return;
    this.warnings.dataset.key = key;
    this.warnings.replaceChildren(...chips.map((c) => el('span', `chip chip--${c.level}`, c.text)));
  }
}
