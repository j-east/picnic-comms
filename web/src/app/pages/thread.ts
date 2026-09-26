import { Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, Contact, Draft, Thread, relativeUk, senderName } from '../api';

@Component({
  imports: [RouterLink],
  template: `
    <p class="small"><a routerLink="/">← Пошта</a></p>
    @if (thread(); as t) {
      <h1 class="fade">{{ t.subject }}</h1>
      <p class="muted">{{ name(t.from) }} <span class="small">· {{ t.fromEmail }}</span></p>
      @if (t.summaryUk) { <p class="notice">{{ t.summaryUk }}</p> }

      @for (m of t.messages; track m.id) {
        <section class="msg">
          <p class="muted small">{{ name(m.from) }}, {{ when(m.date) }}</p>
          <p class="pre uk">{{ m.bodyUk }}</p>
          @if (m.terms.length) {
            <div class="terms small">
              <span class="muted">Перевірте, як в оригіналі:</span>
              @for (x of m.terms; track $index) { <span class="term">{{ x.en }}</span> }
            </div>
          }
          <details>
            <summary>Оригінал англійською</summary>
            <p class="pre small muted">{{ m.bodyEn }}</p>
          </details>
        </section>
      }

      @if (t.status !== 'done') {
        <h2>Відповідь</h2>
        @if (draft(); as d) {
          <div class="sheet stack fade">
            <p class="muted small">Чернетка вже у Gmail. Прочитайте й натисніть «Надіслати» там.</p>
            <div>
              <p class="small muted">Англійською</p>
              <p class="pre">{{ d.textEn }}</p>
            </div>
            <div>
              <p class="small muted">Що це означає (зворотний переклад)</p>
              <p class="pre">{{ d.backTranslationUk }}</p>
            </div>
            @if (d.notesUk) { <p class="notice">{{ d.notesUk }}</p> }
            <a class="btn btn-accent btn-block" href="https://mail.google.com/mail/#drafts" target="_blank" rel="noopener">Відкрити чернетку в Gmail</a>
            <button class="btn-block" (click)="rewrite()">Переписати</button>
          </div>
        } @else {
          <div class="stack">
            <textarea rows="5" [value]="textUk()" (input)="textUk.set($any($event.target).value)"
              placeholder="Напишіть, що хочете сказати, українською. Англійський лист складеться сам."></textarea>
            @if (error()) { <div class="notice err">{{ error() }}</div> }
            <button class="btn-accent btn-block" [disabled]="busy() || !textUk().trim()" (click)="compose()">
              {{ busy() ? 'Складаю англійською…' : 'Скласти англійською' }}
            </button>
          </div>
        }
        <p class="small muted done-row">
          Відповідь не потрібна? <button class="link" (click)="done()">Позначити як готово</button>
        </p>
      } @else {
        <p class="notice">Готово. Цей лист більше не чекає на вас.</p>
      }
    } @else if (error()) {
      <div class="notice err">{{ error() }}</div>
    } @else {
      <p class="muted">Завантаження…</p>
    }
  `,
  styles: `
    h1 { font-size: 1.4rem; }
    .msg { padding: 16px 0; border-top: 1px solid var(--line); }
    .uk { font-size: 1.05rem; }
    .terms { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
    .term { padding: 2px 8px; border: 1px solid var(--line); border-radius: 8px; font-variant-numeric: tabular-nums; }
    details summary { cursor: pointer; color: var(--muted); font-size: 0.9rem; padding: 6px 0; }
    .done-row { margin-top: 16px; }
    .link { border: 0; background: none; padding: 0; min-height: 0; color: var(--ink); text-decoration: underline; font-weight: 500; }
  `,
})
export class ThreadPage implements OnInit {
  private api = inject(Api);
  private router = inject(Router);
  id = input.required<string>();
  thread = signal<Thread | null>(null);
  contact = signal<Contact | null>(null);
  draft = signal<Draft | null>(null);
  textUk = signal('');
  busy = signal(false);
  error = signal('');
  name = senderName;
  when = relativeUk;

  ngOnInit() {
    this.load();
  }

  async load() {
    try {
      const res = await this.api.thread(this.id());
      this.thread.set(res.thread);
      this.contact.set(res.contact);
      this.draft.set(res.thread.draft ?? null);
      if (res.thread.draft) this.textUk.set(res.thread.draft.textUk);
    } catch {
      this.error.set('Лист не знайдено.');
    }
  }

  async compose() {
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await this.api.reply(this.id(), this.textUk());
      this.draft.set(res.draft);
    } catch {
      this.error.set('Не вдалося скласти лист. Спробуйте ще раз за хвилину.');
    } finally {
      this.busy.set(false);
    }
  }

  rewrite() {
    this.draft.set(null);
  }

  async done() {
    await this.api.done(this.id());
    this.router.navigateByUrl('/');
  }
}
