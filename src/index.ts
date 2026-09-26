import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authRoutes, requireSession } from './auth.js';
import { apiRoutes } from './routes/api.js';
import * as gauth from './gmail/auth.js';
import * as store from './store.js';
import { pollInbound } from './pipeline/inbound.js';
import { reconcileDrafts } from './pipeline/reply.js';
import { maybeWriteDigest } from './pipeline/digest.js';

const app = Fastify({ logger: true });
await app.register(cookie);
app.addHook('preHandler', requireSession);

app.get('/health', async () => ({ ok: true, connected: gauth.isConnected() }));
await app.register(authRoutes);
await app.register(apiRoutes);

// The Angular build, when present (Docker builds it; local dev uses ng serve)
const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..', 'web', 'dist', 'web', 'browser');
if (fs.existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

// ── The loop ──
let running = false;
async function tick() {
  if (running || !gauth.isConnected()) return;
  running = true;
  try {
    const closed = await reconcileDrafts();
    const r = await pollInbound();
    if (r.processed || closed) app.log.info(`poll: ${r.processed} processed, ${closed} drafts closed, ${r.skipped} deferred`);
    await maybeWriteDigest();
  } catch (err) {
    app.log.error(`poll failed: ${err}`);
    const st = await store.state.read();
    st.lastPollError = String(err);
    await store.state.write(st);
  } finally {
    running = false;
  }
}
if (config.pollEnabled) {
  setTimeout(tick, 5_000);
  setInterval(tick, config.pollSeconds * 1000);
}

await app.listen({ port: config.port, host: '0.0.0.0' });
