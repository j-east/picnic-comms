import { ensureLabels } from '../gmail/client.js';

/** Gmail labels are the state Yeva sees in her own mail app. Ukrainian on
 *  purpose: the UI must be in her language, and labels are UI. */
export const LABELS = {
  translated: 'Yeva/Переклад',
  needsReply: 'Yeva/Відповісти',
  low: 'Yeva/Низький пріоритет',
  digest: 'Yeva/Дайджест',
} as const;

let cache: Record<string, string> | null = null;

export async function labelIds(): Promise<Record<keyof typeof LABELS, string>> {
  if (!cache) cache = await ensureLabels(Object.values(LABELS));
  return {
    translated: cache[LABELS.translated],
    needsReply: cache[LABELS.needsReply],
    low: cache[LABELS.low],
    digest: cache[LABELS.digest],
  };
}
