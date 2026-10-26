import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  LockedKeyError,
  LocalKeySigner,
  createLocalKeyLogin,
  isUnlocked,
  lockLocalKey,
  unlockWithNsec,
  unlockWithPassword,
} from './localKey';

const template = { kind: 1, content: 'hi', tags: [], created_at: 0 };

function newNsec() {
  const sk = generateSecretKey();
  return { nsec: nip19.nsecEncode(sk), pubkey: getPublicKey(sk) };
}

describe('local key login', () => {
  it('never stores the plain key, and saves it encrypted only with a password', () => {
    const { nsec, pubkey } = newNsec();

    const sessionOnly = createLocalKeyLogin(nsec);
    expect(sessionOnly.pubkey).toBe(pubkey);
    expect(JSON.stringify(sessionOnly)).not.toContain(nsec);
    expect(sessionOnly.data.ncryptsec).toBeUndefined();

    const remembered = createLocalKeyLogin(nsec, 'correct horse');
    expect(JSON.stringify(remembered)).not.toContain(nsec);
    expect(remembered.data.ncryptsec).toMatch(/^ncryptsec1/);
  });

  it('rejects short passwords and bad keys', () => {
    expect(() => createLocalKeyLogin(newNsec().nsec, 'short')).toThrow(/at least/);
    expect(() => createLocalKeyLogin('nsec1nope')).toThrow(/valid nsec/);
  });

  it('signs while unlocked and refuses once locked', async () => {
    const { nsec, pubkey } = newNsec();
    createLocalKeyLogin(nsec);
    const signer = new LocalKeySigner(pubkey);

    expect((await signer.signEvent(template)).pubkey).toBe(pubkey);

    lockLocalKey(pubkey);
    await expect(signer.signEvent(template)).rejects.toBeInstanceOf(LockedKeyError);
    await expect(signer.nip44.decrypt(pubkey, 'x')).rejects.toBeInstanceOf(LockedKeyError);
  });

  it('unlocks with the right password only', () => {
    const { nsec, pubkey } = newNsec();
    const login = createLocalKeyLogin(nsec, 'correct horse');
    lockLocalKey(pubkey);

    expect(() => unlockWithPassword(login, 'wrong password')).toThrow('Wrong password.');
    expect(isUnlocked(pubkey)).toBe(false);

    unlockWithPassword(login, 'correct horse');
    expect(isUnlocked(pubkey)).toBe(true);
  });

  it('unlocks a session-only login with its own nsec only', () => {
    const { nsec, pubkey } = newNsec();
    const login = createLocalKeyLogin(nsec);
    lockLocalKey(pubkey);

    expect(() => unlockWithNsec(login, newNsec().nsec)).toThrow(/different account/);
    unlockWithNsec(login, nsec);
    expect(isUnlocked(pubkey)).toBe(true);
  });
});
