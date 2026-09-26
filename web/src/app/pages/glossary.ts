import { Component, inject, signal } from '@angular/core';
import { Api } from '../api';

@Component({
  template: `
    <h1>Глосарій</h1>
    <p class="muted">Слова, які завжди перекладаються однаково: назви пакетів, місця, імена клієнтів, ваші улюблені фрази. Використовується в кожному листі.</p>
    <div class="stack">
      <textarea rows="18" [value]="text()" (input)="text.set($any($event.target).value); saved.set(false)" spellcheck="false"></textarea>
      <button class="btn-accent btn-block" [disabled]="busy() || saved()" (click)="save()">
        {{ saved() ? 'Збережено' : busy() ? 'Зберігаю…' : 'Зберегти' }}
      </button>
      @if (error()) { <div class="notice err">{{ error() }}</div> }
    </div>
  `,
  styles: `textarea { font-size: 0.95rem; }`,
})
export class GlossaryPage {
  private api = inject(Api);
  text = signal('');
  busy = signal(false);
  saved = signal(true);
  error = signal('');

  constructor() {
    this.api.glossary().then((r) => this.text.set(r.text)).catch(() => this.error.set('Не вдалося завантажити глосарій.'));
  }

  async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.saveGlossary(this.text());
      this.saved.set(true);
    } catch {
      this.error.set('Не збереглося. Спробуйте ще раз.');
    } finally {
      this.busy.set(false);
    }
  }
}
