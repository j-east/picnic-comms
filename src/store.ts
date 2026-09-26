import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/** Everything durable lives as small files under DATA_DIR. It's one user and
 *  a few hundred threads; a database would be ceremony. Writes are atomic
 *  (tmp + rename) so a crash mid-write can't corrupt state. */

function file(name: string): string {
  return path.join(config.dataDir, name);
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file(name), 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  await fsp.mkdir(config.dataDir, { recursive: true });
  const tmp = file(`${name}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await fsp.rename(tmp, file(name));
}

export async function readText(name: string, fallback = ''): Promise<string> {
  try {
    return await fsp.readFile(file(name), 'utf-8');
  } catch {
    return fallback;
  }
}

export async function writeText(name: string, text: string): Promise<void> {
  await fsp.mkdir(config.dataDir, { recursive: true });
  const tmp = file(`${name}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, text, 'utf-8');
  await fsp.rename(tmp, file(name));
}

export function existsSync(name: string): boolean {
  return fs.existsSync(file(name));
}

// ── Typed documents ──

export type Register = 'formal' | 'friendly';
export type Category = 'client' | 'vendor' | 'newsletter' | 'notification' | 'spam' | 'other';
export type ThreadStatus = 'needs-reply' | 'drafted' | 'done' | 'low';

export interface Term {
  en: string;
  uk: string;
  kind: 'number' | 'date' | 'price' | 'term' | 'name';
}

export interface CachedMessage {
  id: string;
  from: string;
  to: string;
  date: string;
  subject: string;
  bodyEn: string;
  bodyUk: string;
  /** Verbatim items (prices, dates, numbers) the translation flagged */
  terms: Term[];
  /** Message we inserted into Gmail with the Ukrainian text, if any */
  translationMessageId?: string;
}

export interface Draft {
  draftId: string;
  messageId: string;
  textUk: string;
  textEn: string;
  backTranslationUk: string;
  notesUk: string;
  createdAt: string;
}

export interface CachedThread {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  receivedAt: string;
  category: Category;
  priority: number;
  needsReply: boolean;
  summaryUk: string;
  status: ThreadStatus;
  messages: CachedMessage[];
  draft?: Draft;
  doneAt?: string;
}

export type Threads = Record<string, CachedThread>;

export interface Contact {
  email: string;
  name: string;
  register: Register;
  notesUk: string;
  lastSeen: string;
}

export interface Settings {
  /** How her English should read to clients */
  tone: 'warm-professional' | 'formal' | 'casual';
  /** Appended to every drafted reply */
  signatureEn: string;
  /** Local hour (0-23) the daily digest is written; -1 disables */
  digestHour: number;
  timezone: string;
}

export interface State {
  processed: Record<string, string>; // message id → ISO time
  lastPollAt?: string;
  lastPollError?: string;
  lastDigestDate?: string; // YYYY-MM-DD
  firstRunAt?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  tone: 'warm-professional',
  signatureEn: 'Warm regards,\nYeva\nPicnic Party Jacksonville',
  digestHour: 8,
  timezone: 'America/New_York',
};

export const threads = {
  read: () => readJson<Threads>('threads.json', {}),
  write: (t: Threads) => writeJson('threads.json', t),
};
export const contacts = {
  read: () => readJson<Record<string, Contact>>('contacts.json', {}),
  write: (c: Record<string, Contact>) => writeJson('contacts.json', c),
};
export const settings = {
  read: async () => ({ ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>('settings.json', {})) }),
  write: (s: Settings) => writeJson('settings.json', s),
};
export const state = {
  read: () => readJson<State>('state.json', { processed: {} }),
  write: (s: State) => writeJson('state.json', s),
};
export const glossary = {
  read: () => readText('glossary.md', DEFAULT_GLOSSARY),
  write: (t: string) => writeText('glossary.md', t),
};

export const DEFAULT_GLOSSARY = `# Глосарій / Glossary

Терміни, які завжди перекладаються однаково. Формат: англійська = українська (примітка).
Terms that must always translate the same way. Format: English = Ukrainian (note).

## Бізнес / Business
Picnic Party Jacksonville = Picnic Party Jacksonville (назва не перекладається)
luxury picnic = розкішний пікнік
setup = сервірування / оформлення

## Пакети / Packages

## Клієнти та місця / Clients and venues

## Мої фрази / My stock phrases
`;
