import './ui.css';

const LABELS = ['II', '1×', '2×', '3×'];

export class TopBar {
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly timeEl: HTMLSpanElement;
  private readonly fpsEl: HTMLSpanElement;

  constructor(root: HTMLElement, onSpeed: (index: number) => void) {
    root.classList.add('topbar');

    this.timeEl = document.createElement('span');
    this.timeEl.className = 'topbar__time mono';
    root.append(this.timeEl);

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

  setSpeed(index: number): void {
    this.buttons.forEach((b, i) => b.classList.toggle('active', i === index));
  }

  setTime(text: string): void {
    if (this.timeEl.textContent !== text) this.timeEl.textContent = text;
  }

  setFps(fps: number): void {
    this.fpsEl.textContent = `${fps} fps`;
  }
}
