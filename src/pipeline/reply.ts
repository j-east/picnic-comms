import { config } from '../config.js';
import * as gmail from '../gmail/client.js';
import { draftReply as llmDraft } from '../llm/prompts.js';
import * as store from '../store.js';
import { labelIds } from './labels.js';

/** Her Ukrainian → an English draft in Gmail Drafts, threaded under the
 *  client's message. The app shows both plus a back-translation; she sends
 *  from Gmail. Re-drafting replaces the previous draft. */
export async function draftReplyForThread(threadId: string, textUk: string): Promise<store.Draft> {
  const threads = await store.threads.read();
  const thread = threads[threadId];
  if (!thread) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });

  const [contacts, settings, glossary] = await Promise.all([
    store.contacts.read(), store.settings.read(), store.glossary.read(),
  ]);
  const contact = contacts[thread.fromEmail];

  // Fresh headers from Gmail so threading is right even if the cache is stale
  const live = await gmail.getThreadMessages(threadId);
  const last = [...live].reverse().find((m) => m.fromEmail !== config.mailbox.toLowerCase()) ?? live[live.length - 1];
  const threadEn = live
    .filter((m) => !m.subject.startsWith('[UA] '))
    .map((m) => `${m.from} (${m.date}):\n${m.bodyText.slice(0, 4000)}`)
    .join('\n\n---\n\n');

  const out = await llmDraft({ threadEn, replyUk: textUk, glossary, contact, settings, mailbox: config.mailbox });
  const text = `${out.body_en.trim()}\n\n${settings.signatureEn}`;

  if (thread.draft?.draftId) await gmail.deleteDraft(thread.draft.draftId);
  const created = await gmail.createReplyDraft({
    threadId,
    to: last.from,
    subject: last.subject,
    text,
    inReplyTo: last.messageIdHeader || undefined,
    references: [last.references, last.messageIdHeader].filter(Boolean).join(' ') || undefined,
  });

  const draft: store.Draft = {
    draftId: created.draftId,
    messageId: created.messageId,
    textUk,
    textEn: text,
    backTranslationUk: out.back_translation_uk,
    notesUk: out.notes_uk,
    createdAt: new Date().toISOString(),
  };
  thread.draft = draft;
  thread.status = 'drafted';
  await store.threads.write(threads);
  return draft;
}

/** A draft that disappeared from Drafts was sent (or discarded). Either way
 *  the thread no longer needs her, so clear the label and mark it done. */
export async function reconcileDrafts(): Promise<number> {
  const threads = await store.threads.read();
  const ids = await labelIds();
  let closed = 0;
  for (const t of Object.values(threads)) {
    if (t.status !== 'drafted' || !t.draft) continue;
    if (await gmail.draftExists(t.draft.draftId)) continue;
    t.status = 'done';
    t.doneAt = new Date().toISOString();
    await gmail.modifyThreadLabels(t.id, [], [ids.needsReply]).catch(() => undefined);
    closed++;
  }
  if (closed) await store.threads.write(threads);
  return closed;
}

export async function markDone(threadId: string): Promise<void> {
  const threads = await store.threads.read();
  const t = threads[threadId];
  if (!t) throw Object.assign(new Error('unknown thread'), { statusCode: 404 });
  const ids = await labelIds();
  t.status = 'done';
  t.doneAt = new Date().toISOString();
  await gmail.modifyThreadLabels(t.id, [], [ids.needsReply]).catch(() => undefined);
  await store.threads.write(threads);
}
