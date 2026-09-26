import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ThreadStatus = 'needs-reply' | 'drafted' | 'done' | 'low';
export type Category = 'client' | 'vendor' | 'newsletter' | 'notification' | 'spam' | 'other';

export interface Term { en: string; uk: string; kind: string }
export interface Message {
  id: string; from: string; to: string; date: string; subject: string;
  bodyEn: string; bodyUk: string; terms: Term[];
}
export interface Draft {
  draftId: string; textUk: string; textEn: string; backTranslationUk: string; notesUk: string; createdAt: string;
}
export interface ThreadSummary {
  id: string; subject: string; from: string; fromEmail: string; receivedAt: string;
  category: Category; priority: number; needsReply: boolean; summaryUk: string;
  status: ThreadStatus; messageCount: number; hasDraft: boolean;
}
export interface Thread extends Omit<ThreadSummary, 'messageCount' | 'hasDraft'> {
  messages: Message[]; draft?: Draft;
}
export interface Contact { email: string; name: string; register: 'formal' | 'friendly'; notesUk: string; lastSeen: string }
export interface Settings { tone: 'warm-professional' | 'formal' | 'casual'; signatureEn: string; digestHour: number; timezone: string }
export interface Status {
  mailbox: string; connected: boolean; lastPollAt: string | null; lastPollError: string | null;
  counts: { needsReply: number; drafted: number; done: number; low: number };
}

/** Thin typed client over the server's JSON API. The session cookie rides along. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  status() { return firstValueFrom(this.http.get<Status>('/api/status')); }
  threads(status?: ThreadStatus) {
    return firstValueFrom(this.http.get<{ threads: ThreadSummary[] }>('/api/threads', { params: status ? { status } : {} }));
  }
  thread(id: string) { return firstValueFrom(this.http.get<{ thread: Thread; contact: Contact | null }>(`/api/threads/${id}`)); }
  reply(id: string, textUk: string) { return firstValueFrom(this.http.post<{ draft: Draft }>(`/api/threads/${id}/reply`, { textUk })); }
  done(id: string) { return firstValueFrom(this.http.post(`/api/threads/${id}/done`, {})); }
  glossary() { return firstValueFrom(this.http.get<{ text: string }>('/api/glossary')); }
  saveGlossary(text: string) { return firstValueFrom(this.http.put('/api/glossary', { text })); }
  settings() { return firstValueFrom(this.http.get<Settings>('/api/settings')); }
  saveSettings(s: Partial<Settings>) { return firstValueFrom(this.http.put<Settings>('/api/settings', s)); }
  contacts() { return firstValueFrom(this.http.get<{ contacts: Contact[] }>('/api/contacts')); }
  saveContact(email: string, c: Partial<Contact>) {
    return firstValueFrom(this.http.put<Contact>(`/api/contacts/${encodeURIComponent(email)}`, c));
  }
  poll() { return firstValueFrom(this.http.post<{ processed: number; closed: number }>('/api/poll', {})); }
  digest() { return firstValueFrom(this.http.post<{ written: boolean }>('/api/digest', {})); }
}

/** "1 лист", "3 листи", "7 листів" */
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function relativeUk(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 2) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ${pluralUk(h, 'годину', 'години', 'годин')} тому`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} ${pluralUk(d, 'день', 'дні', 'днів')} тому`;
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

export function senderName(from: string): string {
  return from.replace(/<.*>/, '').replace(/"/g, '').trim() || from;
}
