import './ui.css';

const LABELS = ['II', '1×', '2×', '3×'];

export interface PawnChip {
  id: number;
  name: string;
  color: string;
}

export class TopBar {
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly chips = new Map<number, HTMLButtonElement>();
  private readonly timeEl: HTMLDivElement;
  private readonly dayEl: HTMLSpanElement;
  private readonly clockEl: HTMLSpanElement;
  private readonly fpsEl: HTMLSpanElement;
  private readonly pawnsEl: HTMLDivElement;

  constructor(
    root: HTMLElement,
    onSpeed: (index: number) => void,
    private readonly onPawn: (id: number) => void,
  ) {
    root.classList.add('topbar');

    this.timeEl = document.createElement('div');
    this.timeEl.className = 'topbar__time mono';
    this.dayEl = document.createElement('span');
    this.dayEl.className = 'topbar__day';
    this.clockEl = document.createElement('span');
    this.clockEl.className = 'topbar__clock';
    this.timeEl.append(this.dayEl, this.clockEl);
    root.append(this.timeEl);

    this.pawnsEl = document.createElement('div');
    this.pawnsEl.className = 'topbar__pawns';
    root.append(this.pawnsEl);

    const spacer = document.createElement('span');
    spacer.className = 'topbar__spacer';
    root.append(spacer);

    const group = document.createElement('div');
    group.className = 'topbar__speeds';
    LABELS.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', i === 0 ? 'Пауза' : `Скорость ${label}`);
      b.addEventListener('click', () => onSpeed(i));
      group.append(b);
      this.buttons.push(b);
    });
    root.append(group);

    this.fpsEl = document.createElement('span');
    this.fpsEl.className = 'topbar__fps mono';
    root.append(this.fpsEl);
  }

  setPawns(pawns: readonly PawnChip[]): void {
    this.pawnsEl.replaceChildren();
    this.chips.clear();
    for (const p of pawns) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name.charAt(0);
      b.title = p.name;
      b.setAttribute('aria-label', p.name);
      b.style.setProperty('--pawn', p.color);
      b.addEventListener('click', () => this.onPawn(p.id));
      this.pawnsEl.append(b);
      this.chips.set(p.id, b);
    }
  }

  setSelected(id: number | null): void {
    for (const [pid, b] of this.chips) b.classList.toggle('selected', pid === id);
  }

  setSpeed(index: number): void {
    this.buttons.forEach((b, i) => b.classList.toggle('active', i === index));
  }

  /** Две строки: день (сверху) и время (снизу). */
  setTime(day: string, clock: string): void {
    if (this.dayEl.textContent !== day) this.dayEl.textContent = day;
    if (this.clockEl.textContent !== clock) this.clockEl.textContent = clock;
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${fps} fps`;
  }
}
