import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one guarantee that matters: this app cannot send email. Gmail has no
 *  scope for "drafts but never send", so the promise lives in code — and this
 *  test is what keeps it there. */
const dir = path.dirname(fileURLToPath(import.meta.url));

test('gmail client has no send path', () => {
  const src = fs.readFileSync(path.join(dir, 'client.ts'), 'utf-8');
  assert.doesNotMatch(src, /\.send\s*\(/, 'client.ts must not call any .send()');
  assert.doesNotMatch(src, /messages\.send|drafts\.send|sendAs/, 'client.ts must not reference Gmail send endpoints');
});

test('no other module talks to the Gmail API directly', () => {
  const srcRoot = path.resolve(dir, '..');
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const offenders = walk(srcRoot)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => !f.endsWith(path.join('gmail', 'client.ts')) && !f.endsWith(path.join('gmail', 'auth.ts')))
    .filter((f) => /google\.gmail\(|users\.messages|users\.drafts/.test(fs.readFileSync(f, 'utf-8')));
  assert.deepEqual(offenders, [], `Gmail API used outside gmail/client.ts: ${offenders.join(', ')}`);
});

test('the send scope is never requested', async () => {
  const src = fs.readFileSync(path.join(dir, 'auth.ts'), 'utf-8');
  assert.doesNotMatch(src, /gmail\.send/, 'auth.ts must not request the gmail.send scope');
});
