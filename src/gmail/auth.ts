import { google, type Auth } from 'googleapis';
type OAuth2Client = Auth.OAuth2Client;
import { config } from '../config.js';
import { readJson, writeJson, existsSync } from '../store.js';

/** Google OAuth for the one mailbox. Web-app flow: John opens /oauth/start
 *  while signed in as Yeva's Workspace account (or she does), Google redirects
 *  back to /oauth/callback, and the refresh token lands in DATA_DIR.
 *
 *  gmail.modify is needed to apply labels and insert the Ukrainian copies
 *  into her threads. It technically permits sending — the no-send guarantee
 *  is enforced in gmail/client.ts and its test, not by scope. */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const TOKEN_FILE = 'google-token.json';

interface StoredToken {
  access_token?: string | null;
  refresh_token?: string | null;
  scope?: string;
  token_type?: string | null;
  expiry_date?: number | null;
}

function newClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    `${config.publicUrl}/oauth/callback`,
  );
}

export function authUrl(): string {
  return newClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    login_hint: config.mailbox,
  });
}

export async function handleCallback(code: string): Promise<void> {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token; revoke the app in the account and try again');
  }
  await writeJson(TOKEN_FILE, tokens);
}

export function isConnected(): boolean {
  return existsSync(TOKEN_FILE);
}

let cached: OAuth2Client | null = null;

export async function getClient(): Promise<OAuth2Client> {
  if (cached) return cached;
  const token = await readJson<StoredToken | null>(TOKEN_FILE, null);
  if (!token?.refresh_token) throw new Error('Google account not connected; open /oauth/start');
  const client = newClient();
  client.setCredentials(token);
  client.on('tokens', (fresh) => {
    // Persist refreshed access tokens so restarts don't re-consent
    readJson<StoredToken>(TOKEN_FILE, {})
      .then((existing) => writeJson(TOKEN_FILE, { ...existing, ...fresh }))
      .catch(() => undefined);
  });
  cached = client;
  return client;
}

export async function disconnect(): Promise<void> {
  cached = null;
  await writeJson(TOKEN_FILE, {});
}
