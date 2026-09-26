import { Component, inject, signal } from '@angular/core';
import { Api, Contact, Settings, Status, relativeUk } from '../api';

@Component({
  template: `
    <h1>Налаштування</h1>

    <h2>Gmail</h2>
    @if (status(); as s) {
      <div class="sheet stack">
        @if (s.connected) {
          <p>Під’єднано: <b>{{ s.mailbox }}</b></p>
          <p class="muted small">
            @if (s.lastPollAt) { Останнє оновлення {{ when(s.lastPollAt) }}. } @else { Ще не оновлювалося. }
            @if (s.lastPollError) { <span class="err-text">Помилка: {{ s.lastPollError }}</span> }
          </p>
          <div class="pair">
            <button [disabled]="busy()" (click)="poll()">{{ busy() ? 'Оновлюю…' : 'Оновити зараз' }}</button>
            <button [disabled]="busy()" (click)="digest()">Дайджест зараз</button>
          </div>
          @if (msg()) { <p class="notice">{{ msg() }}</p> }
        } @else if (!s.googleConfigured) {
          <p>Пошту ще не під’єднано.</p>
          <p class="muted small">Джон ще налаштовує доступ до Google. Коли все буде готово, тут з’явиться кнопка.</p>
        } @else {
          <p>Пошту ще не під’єднано.</p>
          <a class="btn btn-accent btn-block" href="/oauth/start">Під’єднати {{ s.mailbox }}</a>
          <p class="muted small">Увійдіть у Google саме цією поштою і дозвольте доступ. Програма ніколи не надсилає листи сама.</p>
        }
      </div>
    }

    <h2>Як звучать мої листи</h2>
    @if (form(); as f) {
      <div class="sheet stack">
        <label>Тон англійською
          <select [value]="f.tone" (change)="patch('tone', $any($event.target).value)">
            <option value="warm-professional">Тепло і професійно</option>
            <option value="formal">Офіційно</option>
            <option value="casual">Невимушено</option>
          </select>
        </label>
        <label>Підпис (додається до кожної відповіді)
          <textarea rows="3" [value]="f.signatureEn" (input)="patch('signatureEn', $any($event.target).value)"></textarea>
        </label>
        <label>Ранковий дайджест о
          <select [value]="f.digestHour" (change)="patch('digestHour', +$any($event.target).value)">
            <option [value]="-1">Не надсилати</option>
            @for (h of hours; track h) { <option [value]="h">{{ h }}:00</option> }
          </select>
        </label>
        <button class="btn-accent btn-block" [disabled]="busy() || saved()" (click)="save()">{{ saved() ? 'Збережено' : 'Зберегти' }}</button>
      </div>
    }

    <h2>Клієнти</h2>
    <p class="muted small">Як звертатися до кожного: офіційно чи по-дружньому. Визначається саме, але можна змінити.</p>
    @if (contacts().length) {
      <div class="sheet list">
        @for (c of contacts(); track c.email) {
          <div class="row contact">
            <div class="who"><b>{{ c.name }}</b><span class="muted small">{{ c.email }}</span></div>
            <select [value]="c.register" (change)="setRegister(c, $any($event.target).value)" aria-label="Стиль звертання">
              <option value="friendly">По-дружньому</option>
              <option value="formal">Офіційно</option>
            </select>
          </div>
        }
      </div>
    } @else {
      <p class="muted">Клієнти з’являться тут після перших листів.</p>
    }
  `,
  styles: `
    label { display: grid; gap: 6px; font-weight: 500; }
    .pair { display: flex; gap: 8px; }
    .pair button { flex: 1; }
    .list { padding: 0; }
    .contact { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
    .who { display: grid; flex: 1; min-width: 0; }
    .who span { overflow: hidden; text-overflow: ellipsis; }
    .contact select { width: auto; }
    .err-text { color: var(--accent); }
  `,
})
export class SettingsPage {
  private api = inject(Api);
  status = signal<Status | null>(null);
  form = signal<Settings | null>(null);
  contacts = signal<Contact[]>([]);
  busy = signal(false);
  saved = signal(true);
  msg = signal('');
  when = relativeUk;
  hours = Array.from({ length: 24 }, (_, i) => i);

  constructor() {
    this.api.status().then((s) => this.status.set(s)).catch(() => undefined);
    this.api.settings().then((s) => this.form.set(s)).catch(() => undefined);
    this.api.contacts().then((r) => this.contacts.set(r.contacts)).catch(() => undefined);
  }

  patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
    this.saved.set(false);
  }

  async save() {
    const f = this.form();
    if (!f) return;
    this.busy.set(true);
    try {
      this.form.set(await this.api.saveSettings(f));
      this.saved.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  async poll() {
    this.busy.set(true);
    this.msg.set('');
    try {
      const r = await this.api.poll();
      this.msg.set(r.processed ? `Оброблено нових листів: ${r.processed}.` : 'Нових листів немає.');
      this.status.set(await this.api.status());
    } catch {
      this.msg.set('Не вдалося оновити. Спробуйте пізніше.');
    } finally {
      this.busy.set(false);
    }
  }

  async digest() {
    this.busy.set(true);
    try {
      const r = await this.api.digest();
      this.msg.set(r.written ? 'Дайджест уже в Gmail.' : 'Немає що додати в дайджест.');
    } finally {
      this.busy.set(false);
    }
  }

  async setRegister(c: Contact, register: 'formal' | 'friendly') {
    const saved = await this.api.saveContact(c.email, { register });
    this.contacts.update((list) => list.map((x) => (x.email === c.email ? saved : x)));
  }
}
