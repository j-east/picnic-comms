import { config } from '../config.js';
import * as gmail from '../gmail/client.js';
import { writeDigest } from '../llm/prompts.js';
import * as store from '../store.js';
import { labelIds } from './labels.js';

function localParts(tz: string): { date: string; hour: number } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now));
  return { date, hour: hour === 24 ? 0 : hour };
}

/** Once a day, at her chosen hour, a Ukrainian digest lands in her inbox
 *  (inserted, not sent). Called from the poll tick; cheap when it's not time. */
export async function maybeWriteDigest(force = false): Promise<boolean> {
  const [settings, st] = await Promise.all([store.settings.read(), store.state.read()]);
  if (settings.digestHour < 0 && !force) return false;
  const { date, hour } = localParts(settings.timezone);
  if (!force && (st.lastDigestDate === date || hour < settings.digestHour)) return false;

  const since = Date.now() - 24 * 3600_000;
  const threads = Object.values(await store.threads.read())
    .filter((t) => Date.parse(t.receivedAt) >= since)
    .sort((a, b) => b.priority - a.priority);
  if (!threads.length && !force) {
    st.lastDigestDate = date;
    await store.state.write(st);
    return false;
  }

  const text = await writeDigest({
    dateLabel: date,
    mailbox: config.mailbox,
    items: threads.map((t) => ({
      subject: t.subject, from: t.from, priority: t.priority, category: t.category, summaryUk: t.summaryUk, status: t.status,
    })),
  });
  const ids = await labelIds();
  await gmail.insertMessage({
    subject: `Дайджест пошти · ${date}`,
    text: `${text}\n\n— Picnic Comms · ${config.publicUrl}`,
    labelIds: [ids.digest, 'INBOX', 'UNREAD'],
    fromName: 'Picnic Comms',
  });
  st.lastDigestDate = date;
  await store.state.write(st);
  return true;
}
