# Picnic Comms

Email for Picnic Party Jacksonville, in Ukrainian. Yeva reads and replies in
Ukrainian; clients receive native English; **nothing sends without her tap**.

## How it works

Every two minutes the server polls the mailbox. Each new email is triaged and
translated. What Yeva sees:

- **In Gmail**: a Ukrainian copy of every real email appears *inside the same
  thread* (`[UA] …`, labeled `Yeva/Переклад`). Threads waiting on her get
  `Yeva/Відповісти`. Newsletters and notifications get `Yeva/Низький
  пріоритет` and leave the inbox. A Ukrainian digest arrives each morning.
- **In the app** (phone-first, Ukrainian): the list of threads that need her,
  each with the English original and Ukrainian translation side by side. She
  writes her reply in Ukrainian; the app drafts the English, shows a
  back-translation so she can verify it, and puts the draft in her Gmail
  Drafts. She sends from Gmail.
- **Glossary and tone**: editable in the app, pinned into every prompt so
  client names, package names and her stock phrases never drift.

Numbers, dates, prices and names pass through verbatim and are listed under
every translation for checking.

## The no-send guarantee

Gmail has no scope that means "drafts but never send". So the guarantee is in
code: `src/gmail/client.ts` is the only module that touches Gmail, it has no
send call, and `src/gmail/no-send.test.ts` fails the Docker build if one ever
appears (or if any other file talks to the Gmail API).

## Layout

```
src/
  index.ts          Fastify: API + web app + the poll loop
  auth.ts           one-user session (login link → cookie)
  config.ts         env
  store.ts          JSON files on DATA_DIR: threads, contacts, settings, state, glossary
  gmail/auth.ts     Google OAuth (web flow), token on DATA_DIR
  gmail/client.ts   read / label / insert / draft. No send.
  llm/openrouter.ts OpenRouter chat
  llm/prompts.ts    analyzeInbound, draftReply, writeDigest
  pipeline/         inbound poll, reply drafting, daily digest, label names
  routes/api.ts     JSON API for the web app + OAuth routes
web/                Angular app (Ukrainian UI)
```

## Run locally

```
cp .env.example .env   # fill in tokens
npm install && npm run dev            # API on :3000
cd web && npm install && npm start    # UI on :4200, proxies /api
```

Node 22+ is required for the Angular build (the Docker image uses it).

## Deploy (Coolify)

1. Create the app from this repo (Dockerfile build pack), set resource limits.
2. Add a persistent volume mounted at `/data` in the Coolify UI.
3. Env vars: everything in `.env.example`. `PUBLIC_URL` must be the real
   https URL; `APP_TOKEN` a long random string.
4. Google Cloud: an **Internal** OAuth client (Web application) under the
   `picnicpartyjacksonville.com` Workspace org, redirect URI
   `PUBLIC_URL/oauth/callback`. Internal apps skip Google's verification.
5. Open `PUBLIC_URL/login/<APP_TOKEN>` in a browser signed in as the mailbox,
   then `PUBLIC_URL/oauth/start` and grant. That's the one-time connection.
6. Send Yeva the login link. On iPhone: Share → Add to Home Screen.

State lives on the volume; the code repo never holds tokens, glossary or mail.
