import { config } from '../config.js';
import * as gmail from '../gmail/client.js';
import { analyzeInbound } from '../llm/prompts.js';
import * as store from '../store.js';
import { LABELS, labelIds } from './labels.js';

/** Poll → triage → translate → put the Ukrainian copy into her thread.
 *  Runs every POLL_SECONDS. Idempotent: anything we've touched carries a
 *  Yeva/ label and is excluded from the next query, and state.processed
 *  backs that up in case a label write failed. */

function formatTerms(terms: store.Term[]): string {
  if (!terms.length) return '';
  return '\n\n— Перевірте (без змін з оригіналу):\n' + terms.map((t) => `• ${t.en}`).join('\n');
}

async function processMessage(
  id: string,
  ctx: { glossary: string; contacts: Record<string, store.Contact>; threads: store.Threads; ids: Awaited<ReturnType<typeof labelIds>> },
): Promise<void> {
  const msg = await gmail.getMessage(id);
  // Skip her own mail and anything we inserted (carries our From name)
  if (msg.fromEmail === config.mailbox.toLowerCase()) return;

  const contact = ctx.contacts[msg.fromEmail];
  const analysis = await analyzeInbound({
    from: msg.from,
    subject: msg.subject,
    body: msg.bodyText,
    glossary: ctx.glossary,
    contact,
    mailbox: config.mailbox,
  });

  const low = analysis.priority <= 1 || ['newsletter', 'notification', 'spam'].includes(analysis.category);
  const now = new Date().toISOString();

  let translationMessageId: string | undefined;
  if (!low) {
    const text = `${analysis.summary_uk}\n\n${'─'.repeat(24)}\n\n${analysis.body_uk || '(без повного перекладу)'}${formatTerms(analysis.terms)}\n\n— Переклад автоматичний. Оригінал нижче в цій же розмові.`;
    translationMessageId = await gmail.insertMessage({
      threadId: msg.threadId,
      subject: `[UA] ${msg.subject}`,
      text,
      labelIds: [ctx.ids.translated, 'INBOX', 'UNREAD'],
      inReplyTo: msg.messageIdHeader || undefined,
      references: [msg.references, msg.messageIdHeader].filter(Boolean).join(' ') || undefined,
      fromName: `Переклад · ${msg.from.replace(/<.*>/, '').trim() || msg.fromEmail}`,
    });
    const add = [ctx.ids.translated, ...(analysis.needs_reply ? [ctx.ids.needsReply] : [])];
    await gmail.modifyLabels(msg.id, add);
    if (analysis.needs_reply) await gmail.modifyThreadLabels(msg.threadId, [ctx.ids.needsReply]);
  } else {
    // Out of her way, still findable, counted in the digest
    await gmail.modifyLabels(msg.id, [ctx.ids.low], ['INBOX']);
  }

  // Thread cache for the web app
  const existing = ctx.threads[msg.threadId];
  const cached: store.CachedMessage = {
    id: msg.id,
    from: msg.from,
    to: msg.to,
    date: msg.date,
    subject: msg.subject,
    bodyEn: msg.bodyText,
    bodyUk: analysis.body_uk || analysis.summary_uk,
    terms: analysis.terms,
    translationMessageId,
  };
  const status: store.ThreadStatus = low ? 'low' : analysis.needs_reply ? 'needs-reply' : existing?.status === 'drafted' ? 'drafted' : 'done';
  ctx.threads[msg.threadId] = {
    id: msg.threadId,
    subject: existing?.subject ?? msg.subject,
    from: msg.from,
    fromEmail: msg.fromEmail,
    receivedAt: msg.date,
    category: analysis.category,
    priority: analysis.priority,
    needsReply: analysis.needs_reply,
    summaryUk: analysis.summary_uk,
    status,
    messages: [...(existing?.messages ?? []).filter((m) => m.id !== msg.id), cached],
    draft: existing?.draft,
    doneAt: status === 'done' ? existing?.doneAt ?? now : undefined,
  };

  // Learn the contact's register the first time we see them
  if (!contact && !low) {
    ctx.contacts[msg.fromEmail] = {
      email: msg.fromEmail,
      name: msg.from.replace(/<.*>/, '').replace(/"/g, '').trim() || msg.fromEmail,
      register: analysis.register_guess === 'formal' ? 'formal' : 'friendly',
      notesUk: '',
      lastSeen: now,
    };
  } else if (contact) {
    contact.lastSeen = now;
  }
}

export async function pollInbound(): Promise<{ processed: number; skipped: number }> {
  const st = await store.state.read();
  const firstRun = !st.firstRunAt;
  if (firstRun) st.firstRunAt = new Date().toISOString();

  const ids = await labelIds();
  const exclude = Object.values(LABELS).map((l) => `-label:"${l}"`).join(' ');
  const window = firstRun ? `newer_than:${config.backfillDays}d` : 'newer_than:2d';
  const query = `in:inbox ${exclude} ${window} -from:${config.mailbox}`;

  const candidates = (await gmail.listMessageIds(query, 100)).filter((id) => !st.processed[id]);
  const batch = candidates.slice(0, config.maxPerPoll);

  const ctx = {
    glossary: await store.glossary.read(),
    contacts: await store.contacts.read(),
    threads: await store.threads.read(),
    ids,
  };

  let processed = 0;
  for (const id of batch) {
    try {
      await processMessage(id, ctx);
      processed++;
    } catch (err) {
      console.error(`inbound: message ${id} failed: ${err}`);
      continue; // leave it unprocessed; next poll retries
    }
    st.processed[id] = new Date().toISOString();
    // Persist as we go so a crash mid-batch loses at most one message
    await store.threads.write(ctx.threads);
    await store.state.write(st);
  }
  await store.contacts.write(ctx.contacts);

  // Forget processed ids older than 30 days; the labels carry the truth
  const cutoff = Date.now() - 30 * 86_400_000;
  for (const [id, at] of Object.entries(st.processed)) {
    if (Date.parse(at) < cutoff) delete st.processed[id];
  }
  st.lastPollAt = new Date().toISOString();
  st.lastPollError = undefined;
  await store.state.write(st);
  return { processed, skipped: candidates.length - batch.length };
}
