import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';

import { buildBackup, parseBackup } from './noteBackup';

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

function signedNote(d: string, sk = secretKey) {
  return finalizeEvent(
    { kind: 30078, created_at: 1000, content: 'ciphertext', tags: [['d', d]] },
    sk,
  );
}

describe('parseBackup', () => {
  it('round-trips a backup built by buildBackup', () => {
    const events = [signedNote('n1'), signedNote('n2')];
    const json = JSON.stringify(buildBackup(pubkey, events));

    const result = parseBackup(json, pubkey);

    expect(result.events).toHaveLength(2);
    expect(result.skipped).toBe(0);
  });

  it('skips events from another author', () => {
    const json = JSON.stringify(buildBackup(pubkey, [signedNote('n1', generateSecretKey())]));

    expect(parseBackup(json, pubkey)).toEqual({ events: [], skipped: 1 });
  });

  it('skips events whose content was tampered with', () => {
    const tampered = { ...signedNote('n1'), content: 'something else' };
    const json = JSON.stringify(buildBackup(pubkey, [tampered]));

    expect(parseBackup(json, pubkey).skipped).toBe(1);
  });

  it('skips events without a d tag', () => {
    const noD = finalizeEvent({ kind: 30078, created_at: 1000, content: 'x', tags: [] }, secretKey);
    const json = JSON.stringify(buildBackup(pubkey, [noD]));

    expect(parseBackup(json, pubkey).skipped).toBe(1);
  });

  it('rejects non-JSON, foreign files and newer versions', () => {
    expect(() => parseBackup('not json', pubkey)).toThrow('not valid JSON');
    expect(() => parseBackup('{"hello":1}', pubkey)).toThrow('not a My Notes backup');

    const future = { ...buildBackup(pubkey, []), version: 99 };
    expect(() => parseBackup(JSON.stringify(future), pubkey)).toThrow('newer version');
  });
});
