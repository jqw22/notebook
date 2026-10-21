import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { eventAddress, mergeEvents } from './noteStore';

function makeEvent(overrides: Partial<NostrEvent> & { d?: string }): NostrEvent {
  const { d, ...rest } = overrides;
  return {
    id: Math.random().toString(16).slice(2),
    pubkey: 'a'.repeat(64),
    kind: 30078,
    created_at: 1000,
    content: 'ciphertext',
    tags: d === undefined ? [] : [['d', d]],
    sig: 'sig',
    ...rest,
  };
}

describe('eventAddress', () => {
  it('builds kind:pubkey:d', () => {
    expect(eventAddress(makeEvent({ d: 'note-1' }))).toBe(`30078:${'a'.repeat(64)}:note-1`);
  });

  it('is undefined without a d tag', () => {
    expect(eventAddress(makeEvent({}))).toBeUndefined();
  });
});

describe('mergeEvents', () => {
  it('keeps the newest version of each note across sets', () => {
    const older = makeEvent({ d: 'n1', created_at: 100, content: 'old' });
    const newer = makeEvent({ d: 'n1', created_at: 200, content: 'new' });
    const other = makeEvent({ d: 'n2', created_at: 150 });

    const merged = mergeEvents([newer], [older, other]);

    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.tags[0][1] === 'n1')?.content).toBe('new');
  });

  it('keeps tombstones so a deletion beats an older cached copy', () => {
    const cached = makeEvent({ d: 'n1', created_at: 100, content: 'ciphertext' });
    const tombstone = makeEvent({ d: 'n1', created_at: 200, content: '' });

    expect(mergeEvents([cached], [tombstone])).toEqual([tombstone]);
  });

  it('drops events of other kinds or without a d tag', () => {
    const wrongKind = makeEvent({ d: 'n1', kind: 1 });
    const noD = makeEvent({});

    expect(mergeEvents([wrongKind, noD])).toEqual([]);
  });
});
