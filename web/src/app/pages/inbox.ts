import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, ThreadStatus, ThreadSummary, pluralUk, relativeUk, senderName } from '../api';

type Filter = 'needs-reply' | 'drafted' | 'done';

@Component({
  imports: [RouterLink],
  template: `
    <h1 class="fade">{{ headline() }}</h1>
    <p class="muted">{{ sub() }}</p>

    <div class="chips" role="tablist">
      @for (f of filters; track f.key) {
        <button role="tab" [class.on]="filter() === f.key" (click)="setFilter(f.key)">{{ f.label }}</button>
      }
    </div>

    @if (error()) {
      <div class="notice err">{{ error() }}</div>
    } @else if (loading()) {
      <p class="muted">Завантаження…</p>
    } @else if (!list().length) {
      <div class="notice">{{ empty() }}</div>
    } @else {
      <div class="sheet list">
        @for (t of list(); track t.id) {
          <a class="row" [routerLink]="['/thread', t.id]">
            <span class="dot" [class.hot]="t.status === 'needs-reply'" [class.warm]="t.status === 'drafted'"></span>
            <span class="body">
              <span class="top">
                <b>{{ name(t.from) }}</b>
                <span class="muted small">{{ when(t.receivedAt) }}</span>
              </span>
              <span class="subject">{{ t.subject }}</span>
              <span class="muted summary">{{ t.summaryUk }}</span>
            </span>
          </a>
        }
      </div>
    }
  `,
  styles: `
    .list { padding: 0; overflow: hidden; }
    .row { display: flex; gap: 12px; padding: 14px 16px; text-decoration: none; color: inherit; }
    .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 8px; background: var(--line); }
    .dot.hot { background: var(--accent); }
    .dot.warm { background: var(--sun); }
    .body { display: grid; gap: 2px; min-width: 0; flex: 1; }
    .top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .subject { font-weight: 500; }
    .summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  `,
})
export class InboxPage {
  private api = inject(Api);
  readonly filters: { key: Filter; label: string }[] = [
    { key: 'needs-reply', label: 'Чекають' },
    { key: 'drafted', label: 'Чернетки' },
    { key: 'done', label: 'Готово' },
  ];
  filter = signal<Filter>('needs-reply');
  list = signal<ThreadSummary[]>([]);
  counts = signal({ needsReply: 0, drafted: 0 });
  loading = signal(true);
  error = signal('');

  headline = computed(() => {
    const n = this.counts().needsReply;
    if (n === 0) return 'Усе відповіли';
    return `${n} ${pluralUk(n, 'лист чекає', 'листи чекають', 'листів чекають')} на вас`;
  });
  sub = computed(() => {
    const d = this.counts().drafted;
    return d ? `${d} ${pluralUk(d, 'чернетка готова', 'чернетки готові', 'чернеток готові')} у Gmail` : 'Нові листи з’являться тут самі';
  });
  empty = computed(() => ({
    'needs-reply': 'Ніхто не чекає на відповідь.',
    drafted: 'Чернеток немає. Напишіть відповідь у листі, і вона з’явиться тут.',
    done: 'Ще нічого не завершено.',
  })[this.filter()]);

  constructor() {
    this.load();
  }

  name = senderName;
  when = relativeUk;

  setFilter(f: Filter) {
    this.filter.set(f);
    this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [status, res] = await Promise.all([this.api.status(), this.api.threads(this.filter() as ThreadStatus)]);
      this.counts.set(status.counts);
      this.list.set(res.threads);
      if (!status.connected) this.error.set('Gmail не під’єднано. Відкрийте Налаштування.');
    } catch {
      this.error.set('Не вдалося завантажити пошту. Перевірте з’єднання і спробуйте ще раз.');
    } finally {
      this.loading.set(false);
    }
  }
}
