import { google, type gmail_v1 } from 'googleapis';
import { getClient } from './auth.js';
import { config } from '../config.js';

/** The only module that talks to Gmail. It can read, label, insert, and
 *  draft. It cannot send: there is no send call in this file, and
 *  no-send.test.ts fails the build if one ever appears. */

async function gmail(): Promise<gmail_v1.Gmail> {
  return google.gmail({ version: 'v1', auth: await getClient() });
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: string;
  messageIdHeader: string;
  references: string;
  labelIds: string[];
  bodyText: string;
  snippet: string;
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function decode(data?: string | null): string {
  return data ? Buffer.from(data, 'base64url').toString('utf-8') : '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Prefer text/plain; fall back to stripped HTML. Walks multipart trees. */
function extractBody(part?: gmail_v1.Schema$MessagePart): { text: string; html: string } {
  const out = { text: '', html: '' };
  if (!part) return out;
  const walk = (p: gmail_v1.Schema$MessagePart) => {
    if (p.mimeType === 'text/plain' && p.body?.data && !out.text) out.text = decode(p.body.data);
    else if (p.mimeType === 'text/html' && p.body?.data && !out.html) out.html = decode(p.body.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(part);
  return out;
}

export function parseEmailAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function parseMessage(msg: gmail_v1.Schema$Message): ParsedMessage {
  const body = extractBody(msg.payload);
  const from = header(msg, 'From');
  return {
    id: msg.id ?? '',
    threadId: msg.threadId ?? '',
    from,
    fromEmail: parseEmailAddress(from),
    to: header(msg, 'To'),
    subject: header(msg, 'Subject'),
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : header(msg, 'Date'),
    messageIdHeader: header(msg, 'Message-ID'),
    references: header(msg, 'References'),
    labelIds: msg.labelIds ?? [],
    bodyText: (body.text || stripHtml(body.html)).slice(0, 20_000),
    snippet: msg.snippet ?? '',
  };
}

export async function listMessageIds(query: string, max = 50): Promise<string[]> {
  const g = await gmail();
  const res = await g.users.messages.list({ userId: 'me', q: query, maxResults: max });
  return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
}

export async function getMessage(id: string): Promise<ParsedMessage> {
  const g = await gmail();
  const res = await g.users.messages.get({ userId: 'me', id, format: 'full' });
  return parseMessage(res.data);
}

export async function getThreadMessages(threadId: string): Promise<ParsedMessage[]> {
  const g = await gmail();
  const res = await g.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  return (res.data.messages ?? []).map(parseMessage);
}

/** Labels are the state Yeva can see in her normal mail app. */
export async function ensureLabels(names: string[]): Promise<Record<string, string>> {
  const g = await gmail();
  const existing = (await g.users.labels.list({ userId: 'me' })).data.labels ?? [];
  const ids: Record<string, string> = {};
  for (const name of names) {
    const found = existing.find((l) => l.name === name);
    if (found?.id) {
      ids[name] = found.id;
      continue;
    }
    const created = await g.users.labels.create({
      userId: 'me',
      requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    ids[name] = created.data.id!;
  }
  return ids;
}

export async function modifyLabels(messageId: string, add: string[], remove: string[] = []): Promise<void> {
  const g = await gmail();
  await g.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: add, removeLabelIds: remove },
  });
}

export async function modifyThreadLabels(threadId: string, add: string[], remove: string[] = []): Promise<void> {
  const g = await gmail();
  await g.users.threads.modify({
    userId: 'me',
    id: threadId,
    requestBody: { addLabelIds: add, removeLabelIds: remove },
  });
}

function encodeHeader(value: string): string {
  return /[^\x20-\x7e]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=` : value;
}

export function buildRaw(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  const mime = lines.join('\r\n') + '\r\n\r\n' + Buffer.from(opts.text, 'utf-8').toString('base64');
  return Buffer.from(mime).toString('base64url');
}

/** Drop a message into the mailbox without sending anything: this is how the
 *  Ukrainian copy appears inside the original thread, and how the daily
 *  digest arrives. `insert` bypasses SMTP entirely. */
export async function insertMessage(opts: {
  threadId?: string;
  subject: string;
  text: string;
  labelIds: string[];
  inReplyTo?: string;
  references?: string;
  fromName: string;
}): Promise<string> {
  const g = await gmail();
  const raw = buildRaw({
    from: `${encodeHeader(opts.fromName)} <${config.mailbox}>`,
    to: config.mailbox,
    subject: opts.subject,
    text: opts.text,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
  const res = await g.users.messages.insert({
    userId: 'me',
    internalDateSource: 'receivedTime',
    requestBody: { raw, threadId: opts.threadId, labelIds: opts.labelIds },
  });
  return res.data.id!;
}

/** A reply draft in her Drafts folder, threaded under the client's message.
 *  She opens it in Gmail, reads, and taps Send herself. */
export async function createReplyDraft(opts: {
  threadId: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{ draftId: string; messageId: string }> {
  const g = await gmail();
  const raw = buildRaw({
    from: config.mailbox,
    to: opts.to,
    subject: opts.subject.toLowerCase().startsWith('re:') ? opts.subject : `Re: ${opts.subject}`,
    text: opts.text,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
  const res = await g.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw, threadId: opts.threadId } },
  });
  return { draftId: res.data.id!, messageId: res.data.message?.id ?? '' };
}

export async function deleteDraft(draftId: string): Promise<void> {
  const g = await gmail();
  await g.users.drafts.delete({ userId: 'me', id: draftId }).catch(() => undefined);
}

/** null when the draft no longer exists (she sent it, or deleted it) */
export async function draftExists(draftId: string): Promise<boolean> {
  const g = await gmail();
  try {
    await g.users.drafts.get({ userId: 'me', id: draftId, format: 'minimal' });
    return true;
  } catch {
    return false;
  }
}

export async function getProfileEmail(): Promise<string> {
  const g = await gmail();
  return (await g.users.getProfile({ userId: 'me' })).data.emailAddress ?? '';
}
