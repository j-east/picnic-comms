import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import * as store from '../store.js';
import * as gauth from '../gmail/auth.js';
import { getProfileEmail } from '../gmail/client.js';
import { pollInbound } from '../pipeline/inbound.js';
import { draftReplyForThread, markDone, reconcileDrafts } from '../pipeline/reply.js';
import { maybeWriteDigest } from '../pipeline/digest.js';

/** JSON API for the web app. Everything here is behind the session cookie. */
export async function apiRoutes(app: FastifyInstance) {
  app.get('/api/status', async () => {
    const [st, threads] = await Promise.all([store.state.read(), store.threads.read()]);
    const all = Object.values(threads);
    return {
      mailbox: config.mailbox,
      connected: gauth.isConnected(),
      googleConfigured: gauth.isConfigured(),
      lastPollAt: st.lastPollAt ?? null,
      lastPollError: st.lastPollError ?? null,
      counts: {
        needsReply: all.filter((t) => t.status === 'needs-reply').length,
        drafted: all.filter((t) => t.status === 'drafted').length,
        done: all.filter((t) => t.status === 'done').length,
        low: all.filter((t) => t.status === 'low').length,
      },
    };
  });

  app.get<{ Querystring: { status?: string } }>('/api/threads', async (req) => {
    const threads = Object.values(await store.threads.read());
    const status = req.query.status;
    const list = (status ? threads.filter((t) => t.status === status) : threads.filter((t) => t.status !== 'low'))
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
      .map(({ messages, ...t }) => ({ ...t, messageCount: messages.length, hasDraft: !!t.draft }));
    return { threads: list };
  });

  app.get<{ Params: { id: string } }>('/api/threads/:id', async (req, reply) => {
    const t = (await store.threads.read())[req.params.id];
    if (!t) return reply.code(404).send({ error: 'not found' });
    const contact = (await store.contacts.read())[t.fromEmail] ?? null;
    return { thread: t, contact };
  });

  app.post<{ Params: { id: string }; Body: { textUk?: string } }>('/api/threads/:id/reply', async (req, reply) => {
    const textUk = req.body?.textUk?.trim();
    if (!textUk) return reply.code(400).send({ error: 'textUk required' });
    return { draft: await draftReplyForThread(req.params.id, textUk) };
  });

  app.post<{ Params: { id: string } }>('/api/threads/:id/done', async (req) => {
    await markDone(req.params.id);
    return { ok: true };
  });

  app.get('/api/glossary', async () => ({ text: await store.glossary.read() }));
  app.put<{ Body: { text?: string } }>('/api/glossary', async (req, reply) => {
    if (typeof req.body?.text !== 'string') return reply.code(400).send({ error: 'text required' });
    await store.glossary.write(req.body.text);
    return { ok: true };
  });

  app.get('/api/settings', async () => store.settings.read());
  app.put<{ Body: Partial<store.Settings> }>('/api/settings', async (req) => {
    const current = await store.settings.read();
    const next: store.Settings = {
      tone: req.body?.tone ?? current.tone,
      signatureEn: typeof req.body?.signatureEn === 'string' ? req.body.signatureEn : current.signatureEn,
      digestHour: Number.isInteger(req.body?.digestHour) ? Number(req.body!.digestHour) : current.digestHour,
      timezone: req.body?.timezone ?? current.timezone,
    };
    await store.settings.write(next);
    return next;
  });

  app.get('/api/contacts', async () => ({ contacts: Object.values(await store.contacts.read()) }));
  app.put<{ Params: { email: string }; Body: Partial<store.Contact> }>('/api/contacts/:email', async (req) => {
    const contacts = await store.contacts.read();
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const existing = contacts[email] ?? { email, name: email, register: 'friendly' as const, notesUk: '', lastSeen: '' };
    contacts[email] = {
      ...existing,
      name: req.body?.name ?? existing.name,
      register: req.body?.register === 'formal' ? 'formal' : req.body?.register === 'friendly' ? 'friendly' : existing.register,
      notesUk: typeof req.body?.notesUk === 'string' ? req.body.notesUk : existing.notesUk,
    };
    await store.contacts.write(contacts);
    return contacts[email];
  });

  // Manual triggers — handy from the phone, essential while testing
  app.post('/api/poll', async () => {
    const closed = await reconcileDrafts();
    const r = await pollInbound();
    return { ...r, closed };
  });
  app.post('/api/digest', async () => ({ written: await maybeWriteDigest(true) }));

  // Google connection (John runs this once, signed in as the mailbox)
  app.get('/oauth/start', async (_req, reply) => {
    if (!gauth.isConfigured()) return reply.code(503).send('Google OAuth client is not configured on the server yet');
    return reply.redirect(gauth.authUrl());
  });
  app.get<{ Querystring: { code?: string; error?: string } }>('/oauth/callback', async (req, reply) => {
    if (req.query.error || !req.query.code) return reply.code(400).send(`Google said: ${req.query.error ?? 'no code'}`);
    await gauth.handleCallback(req.query.code);
    const email = await getProfileEmail().catch(() => '?');
    return reply.type('text/html').send(`<meta charset="utf-8"><body style="font-family:system-ui;padding:2rem">Connected as <b>${email}</b>. <a href="/">Open the app</a>`);
  });
  app.post('/oauth/disconnect', async () => {
    await gauth.disconnect();
    return { ok: true };
  });
}
