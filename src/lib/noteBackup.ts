import { z } from 'zod';
import { verifyEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Portable encrypted backup format for the notebook.
 *
 * A backup contains the signed kind-30078 events exactly as they live on
 * relays (NIP-44 ciphertext). Importing re-publishes them, so a backup is a
 * genuine disaster-recovery path: relays can be repopulated from a single file.
 */

export const BACKUP_TYPE = 'simple-notebook-encrypted-backup';
export const BACKUP_VERSION = 1;

const NoteEventSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  kind: z.number(),
  created_at: z.number(),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  sig: z.string(),
});

const BackupSchema = z.object({
  type: z.literal(BACKUP_TYPE),
  version: z.number(),
  exportedAt: z.number(),
  app: z.string().optional(),
  pubkey: z.string().optional(),
  events: z.array(NoteEventSchema),
});

export interface BackupFile {
  type: typeof BACKUP_TYPE;
  version: number;
  exportedAt: number;
  app: string;
  pubkey: string;
  events: NostrEvent[];
}

export function buildBackup(pubkey: string, events: NostrEvent[]): BackupFile {
  return {
    type: BACKUP_TYPE,
    version: BACKUP_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    app: 'Simple Notebook',
    pubkey,
    events,
  };
}

export interface ParseBackupResult {
  events: NostrEvent[];
  /** Events present in the file that were not importable (wrong author, unsigned, etc.). */
  skipped: number;
}

/**
 * Validate a backup file and return the events that are safe to import:
 * kind 30078, authored by `pubkey`, carrying a `d` tag, and with a valid
 * signature. Signature verification matters because, unlike events read from
 * relays, an imported event bypasses the relay's own verification.
 */
export function parseBackup(json: string, pubkey: string): ParseBackupResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('That file is not a Simple Notebook backup.');
  }
  if (parsed.data.version > BACKUP_VERSION) {
    throw new Error('That backup was created by a newer version of the app.');
  }

  const events: NostrEvent[] = [];
  let skipped = 0;

  for (const candidate of parsed.data.events) {
    const event = candidate as NostrEvent;
    const hasDTag = event.tags.some(([name]) => name === 'd');
    if (event.kind !== 30078 || event.pubkey !== pubkey || !hasDTag || !verifyEvent(event)) {
      skipped++;
      continue;
    }
    events.push(event);
  }

  return { events, skipped };
}
