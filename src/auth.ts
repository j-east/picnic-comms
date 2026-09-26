import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

const COOKIE = 'pc_session';

function tokenMatches(presented: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(config.appToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One user, one long-lived secret. Yeva opens PUBLIC_URL/login/<token> once
 *  (a link John sends her); the cookie does the rest. The same link works
 *  for John to run the Google connection step. */
export function isAuthed(req: FastifyRequest): boolean {
  const cookie = (req.cookies as Record<string, string | undefined>)?.[COOKIE];
  if (cookie && tokenMatches(cookie)) return true;
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') && tokenMatches(header.slice(7));
}

export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  if (req.url === '/health' || req.url.startsWith('/login/')) return;
  if (isAuthed(req)) return;
  if (req.url.startsWith('/api/') || req.url.startsWith('/oauth/')) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  // The web app itself: a plain page so she isn't staring at JSON
  return reply.code(401).type('text/html').send(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
    + '<body style="font-family:system-ui;padding:2rem;text-align:center">'
    + '<h2>Потрібне посилання для входу</h2><p>Відкрийте посилання, яке надіслав Джон.</p>',
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.get<{ Params: { token: string } }>('/login/:token', async (req, reply) => {
    if (!tokenMatches(req.params.token)) return reply.code(401).send('bad link');
    reply.setCookie(COOKIE, req.params.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicUrl.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 365,
    });
    return reply.redirect('/');
  });
}
