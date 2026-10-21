import { describe, expect, it } from 'vitest';
import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';

import { fetchAllNoteEvents } from './useEncryptedNotes';

function makeEvents(count: number): NostrEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    pubkey: 'pk',
    kind: 30078,
    created_at: 10_000 - i,
    content: 'ciphertext',
    tags: [['d', `note-${i}`]],
    sig: 'sig',
  }));
}

/** A fake pool that serves `events` newest first, honouring `until` and `limit`. */
function fakePool(events: NostrEvent[]) {
  const filters: NostrFilter[] = [];
  const pool = {
    query: async ([filter]: NostrFilter[]) => {
      filters.push(filter);
      return events
        .filter((e) => filter.until === undefined || e.created_at <= filter.until)
        .slice(0, filter.limit);
    },
  } as unknown as NPool;
  return { pool, filters };
}

describe('fetchAllNoteEvents', () => {
  it('stops after one short page', async () => {
    const { pool, filters } = fakePool(makeEvents(50));

    const events = await fetchAllNoteEvents(pool, 'pk', new AbortController().signal);

    expect(events).toHaveLength(50);
    expect(filters).toHaveLength(1);
  });

  it('pages past the 200 limit', async () => {
    const { pool } = fakePool(makeEvents(450));

    const events = await fetchAllNoteEvents(pool, 'pk', new AbortController().signal);

    expect(events).toHaveLength(450);
  });

  it('stops when a relay ignores until', async () => {
    const all = makeEvents(300);
    const pool = { query: async () => all.slice(0, 200) } as unknown as NPool;

    const events = await fetchAllNoteEvents(pool, 'pk', new AbortController().signal);

    expect(events).toHaveLength(200);
  });
});
