import { chat, parseJson } from './openrouter.js';
import type { Category, Contact, Register, Settings, Term } from '../store.js';

/** Every prompt pins the glossary so terminology can't drift email to email,
 *  and every prompt repeats the one rule MT breaks silently: numbers, dates,
 *  prices, names and contract terms pass through verbatim. */

const VERBATIM_RULE = `Numbers, dates, times, prices, quantities, addresses, URLs, product/package names and people's names must pass through VERBATIM — never converted, rounded, reformatted or localized. List each one you carried across in "terms" so the reader can check them.`;

export interface InboundAnalysis {
  category: Category;
  priority: number; // 1 (ignore) – 5 (urgent client)
  needs_reply: boolean;
  summary_uk: string;
  body_uk: string;
  terms: Term[];
  register_guess: Register;
}

export async function analyzeInbound(input: {
  from: string;
  subject: string;
  body: string;
  glossary: string;
  contact?: Contact;
  mailbox: string;
}): Promise<InboundAnalysis> {
  const system = `You are the inbox assistant for a Ukrainian-speaking owner of a luxury picnic business in Jacksonville, Florida (mailbox ${input.mailbox}). She reads only Ukrainian. Your job for each inbound email:
1. Classify it: client (a customer or prospect), vendor, newsletter, notification (automated: receipts, calendar, platform notices), spam, other.
2. Score priority 1-5: 5 = a client waiting on her for a booking/date/money; 4 = client conversation; 3 = vendor or business matter; 2 = informational she should skim; 1 = noise.
3. needs_reply: true only if a human is expecting her to write back.
4. summary_uk: 1-2 sentences in Ukrainian saying what this is and what, if anything, she must do.
5. body_uk: a faithful, natural Ukrainian translation of the full email body for category client/vendor/other with priority >= 2. For newsletters/notifications/spam, body_uk is an empty string (the summary is enough).
6. terms: the verbatim items (see rule).
7. register_guess: "formal" or "friendly" based on how the sender writes.

${VERBATIM_RULE}

Glossary (use these renderings exactly):
${input.glossary}
${input.contact ? `\nKnown contact: ${input.contact.name} <${input.contact.email}>, register: ${input.contact.register}. Notes: ${input.contact.notesUk}` : ''}

Reply with ONLY a JSON object:
{"category":"client|vendor|newsletter|notification|spam|other","priority":1,"needs_reply":false,"summary_uk":"...","body_uk":"...","terms":[{"en":"$450","uk":"$450","kind":"price"}],"register_guess":"formal|friendly"}`;

  const user = `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body}`;
  const out = await chat([{ role: 'system', content: system }, { role: 'user', content: user }]);
  const parsed = parseJson<InboundAnalysis>(out);
  parsed.priority = Math.min(5, Math.max(1, Number(parsed.priority) || 1));
  parsed.terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  parsed.body_uk = parsed.body_uk ?? '';
  parsed.summary_uk = parsed.summary_uk ?? '';
  return parsed;
}

export interface ReplyDraft {
  body_en: string;
  back_translation_uk: string;
  notes_uk: string;
  terms: Term[];
}

export async function draftReply(input: {
  threadEn: string; // the conversation so far, English, oldest first
  replyUk: string; // what she wants to say, in Ukrainian
  glossary: string;
  contact?: Contact;
  settings: Settings;
  mailbox: string;
}): Promise<ReplyDraft> {
  const register: Register = input.contact?.register ?? 'friendly';
  const system = `You write English replies for a Ukrainian-speaking owner of a luxury picnic business in Jacksonville, Florida (${input.mailbox}). She tells you in Ukrainian what she wants to say; you produce the email a fluent, warm, professional American small-business owner would send. Rules:
- Say what she said — no added promises, discounts, dates or commitments she didn't state. If her note is ambiguous, pick the safest reading and flag it in notes_uk.
- Tone: ${input.settings.tone}. Register with this contact: ${register} (formal = polished and courteous; friendly = warm and relaxed, first names).
- Match the thread: answer what the client actually asked, reference specifics from their message.
- Plain text, short paragraphs, no subject line, no signature (it is appended separately).
- back_translation_uk: translate your English reply back into Ukrainian so she can verify it says what she meant.
- notes_uk: 0-2 short Ukrainian notes on anything you had to guess or that she should double-check. Empty string if nothing.
${VERBATIM_RULE}

Glossary (use these renderings exactly):
${input.glossary}
${input.contact ? `\nContact: ${input.contact.name} <${input.contact.email}>. Notes: ${input.contact.notesUk}` : ''}

Reply with ONLY a JSON object:
{"body_en":"...","back_translation_uk":"...","notes_uk":"...","terms":[{"en":"Saturday, October 4","uk":"субота, 4 жовтня","kind":"date"}]}`;

  const user = `Conversation so far (English):\n${input.threadEn}\n\n---\nHer reply (Ukrainian):\n${input.replyUk}`;
  const out = await chat([{ role: 'system', content: system }, { role: 'user', content: user }]);
  const parsed = parseJson<ReplyDraft>(out);
  parsed.terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  parsed.notes_uk = parsed.notes_uk ?? '';
  return parsed;
}

export async function writeDigest(input: {
  dateLabel: string;
  items: { subject: string; from: string; priority: number; category: Category; summaryUk: string; status: string }[];
  mailbox: string;
}): Promise<string> {
  const system = `You write a short daily inbox digest in Ukrainian for a busy business owner. Plain text, phone-friendly. Structure:
1. One line: how many emails, how many need her reply.
2. "Потрібна відповідь" — each item as one line: who, what they want, why it matters. Most urgent first.
3. "До відома" — one line each for informational items worth knowing.
4. Skip noise entirely (newsletters, notifications) — just count them at the end in one line.
Do not invent anything not in the items.`;
  const user = `Digest for ${input.dateLabel}, mailbox ${input.mailbox}:\n` + JSON.stringify(input.items, null, 1);
  return chat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.2 });
}
