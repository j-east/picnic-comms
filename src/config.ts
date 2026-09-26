import path from 'node:path';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Persistent volume: Google token, state, glossary, thread cache */
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  /** Yeva's login link is PUBLIC_URL/login/<APP_TOKEN> */
  appToken: required('APP_TOKEN'),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
  },
  mailbox: process.env.MAILBOX ?? 'chic@picnicpartyjacksonville.com',
  openrouter: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-5',
  },
  pollSeconds: Number(process.env.POLL_SECONDS ?? 120),
  pollEnabled: (process.env.POLL_ENABLED ?? '1') !== '0',
  /** First run looks back this far; later runs only see new mail */
  backfillDays: Number(process.env.BACKFILL_DAYS ?? 7),
  /** Cap per poll so a burst can't run up the LLM bill */
  maxPerPoll: Number(process.env.MAX_PER_POLL ?? 15),
} as const;
