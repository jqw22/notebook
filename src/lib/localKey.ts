import { NSecSigner, type NostrEvent, type NostrSigner } from '@nostrify/nostrify';
import { NLogin, type NLoginType } from '@nostrify/react/login';
import { getPublicKey, nip19 } from 'nostr-tools';
import * as nip49 from 'nostr-tools/nip49';
import { createPasskeyLock, openPasskeyLock, type PasskeyLock } from './passkeyLock';

/*
 * Logging in with a secret key without ever storing it in plain text.
 *
 * The key lives only in memory (the `unlocked` map below), so a reload or a
 * closed tab locks it. A "local key" login saved in localStorage holds only
 * the pubkey and, if the user chose to remember it, the key encrypted with
 * their password (NIP-49 ncryptsec). On the next visit the user unlocks it
 * with the password, or pastes the nsec again if nothing was saved.
 * Instead of a password the key can be locked with a passkey (Face ID /
 * Touch ID), see passkeyLock.ts.
 */

export const LOCAL_KEY_LOGIN = 'x-local-key';

export interface LocalKeyData {
  /** NIP-49 encrypted secret key, only when the user chose to remember it. */
  ncryptsec?: string;
  /** Secret key encrypted with a passkey, when the user chose Face ID. */
  passkey?: PasskeyLock;
  [key: string]: unknown;
}

export interface LocalKeyLogin {
  id: string;
  type: typeof LOCAL_KEY_LOGIN;
  pubkey: string;
  createdAt: string;
  data: LocalKeyData;
}

export function isLocalKeyLogin(login: NLoginType | undefined): login is LocalKeyLogin {
  return login?.type === LOCAL_KEY_LOGIN;
}

const unlocked = new Map<string, Uint8Array>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: re-render when a key is unlocked or locked. */
export function subscribeLocalKeys(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocalKeysVersion(): number {
  return version;
}

export function isUnlocked(pubkey: string): boolean {
  return unlocked.has(pubkey);
}

/** Forget an unlocked key (on logout). */
export function lockLocalKey(pubkey: string) {
  if (unlocked.delete(pubkey)) changed();
}

/** Decode an nsec, or throw a readable error. */
export function decodeNsec(nsec: string): Uint8Array {
  let decoded;
  try {
    decoded = nip19.decode(nsec.trim());
  } catch {
    throw new Error("That isn't a valid nsec1… key.");
  }
  if (decoded.type !== 'nsec') throw new Error("That isn't a valid nsec1… key.");
  return decoded.data;
}

/** Minimum password length for a remembered key. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Create a local key login from an nsec. With a password, the key is saved
 * encrypted so it can be unlocked on later visits; without one, nothing but
 * the pubkey is saved.
 */
export function createLocalKeyLogin(nsec: string, password?: string): LocalKeyLogin {
  const sk = decodeNsec(nsec);
  const pubkey = getPublicKey(sk);
  const data: LocalKeyData = {};
  if (password !== undefined) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    // ksb 0x00: the key has not been handled insecurely as far as we know.
    data.ncryptsec = nip49.encrypt(sk, password, 16, 0x00);
  }
  unlocked.set(pubkey, sk);
  changed();
  return { ...new NLogin(LOCAL_KEY_LOGIN, pubkey, data) };
}

/**
 * Create a local key login whose key is saved encrypted with a new passkey
 * (Face ID / Touch ID). Must be called from a tap.
 */
export async function createLocalKeyLoginWithPasskey(nsec: string): Promise<LocalKeyLogin> {
  const sk = decodeNsec(nsec);
  const pubkey = getPublicKey(sk);
  const npub = nip19.npubEncode(pubkey);
  const passkey = await createPasskeyLock(sk, {
    pubkey,
    label: `My Notes ${npub.slice(0, 12)}…`,
  });
  unlocked.set(pubkey, sk);
  changed();
  return { ...new NLogin(LOCAL_KEY_LOGIN, pubkey, { passkey } as LocalKeyData) };
}

/** Whether a saved login can be unlocked with a passkey. */
export function hasPasskey(login: LocalKeyLogin): boolean {
  const lock = login.data.passkey as PasskeyLock | undefined;
  return typeof lock?.credentialId === 'string';
}

/** Unlock a saved login with its passkey. Must be called from a tap. */
export async function unlockWithPasskey(login: LocalKeyLogin) {
  if (!hasPasskey(login)) throw new Error('This account has no passkey.');
  const sk = await openPasskeyLock(login.data.passkey as PasskeyLock);
  if (getPublicKey(sk) !== login.pubkey) throw new Error("Couldn't unlock with this passkey.");
  unlocked.set(login.pubkey, sk);
  changed();
}

/** Unlock a saved login with its password. Throws on a wrong password. */
export function unlockWithPassword(login: LocalKeyLogin, password: string) {
  const { ncryptsec } = login.data;
  if (typeof ncryptsec !== 'string') throw new Error('This account has no saved key.');
  let sk: Uint8Array;
  try {
    sk = nip49.decrypt(ncryptsec, password);
  } catch {
    throw new Error('Wrong password.');
  }
  if (getPublicKey(sk) !== login.pubkey) throw new Error('Wrong password.');
  unlocked.set(login.pubkey, sk);
  changed();
}

/** Unlock a login by pasting its nsec again. */
export function unlockWithNsec(login: LocalKeyLogin, nsec: string) {
  const sk = decodeNsec(nsec);
  if (getPublicKey(sk) !== login.pubkey) {
    throw new Error("That key belongs to a different account.");
  }
  unlocked.set(login.pubkey, sk);
  changed();
}

export class LockedKeyError extends Error {
  constructor() {
    super('Your account is locked. Unlock it to continue.');
    this.name = 'LockedKeyError';
  }
}

/** Signs with the unlocked key for `pubkey`, or throws LockedKeyError. */
export class LocalKeySigner implements NostrSigner {
  readonly #pubkey: string;

  readonly nip44: NonNullable<NostrSigner['nip44']>;
  readonly nip04: NonNullable<NostrSigner['nip04']>;

  constructor(pubkey: string) {
    this.#pubkey = pubkey;
    this.nip44 = {
      encrypt: async (pubkey, plaintext) => this.#signer().nip44.encrypt(pubkey, plaintext),
      decrypt: async (pubkey, ciphertext) => this.#signer().nip44.decrypt(pubkey, ciphertext),
    };
    this.nip04 = {
      encrypt: async (pubkey, plaintext) => this.#signer().nip04.encrypt(pubkey, plaintext),
      decrypt: async (pubkey, ciphertext) => this.#signer().nip04.decrypt(pubkey, ciphertext),
    };
  }

  #signer(): NSecSigner {
    const sk = unlocked.get(this.#pubkey);
    if (!sk) throw new LockedKeyError();
    return new NSecSigner(sk);
  }

  async getPublicKey(): Promise<string> {
    return this.#pubkey;
  }

  async signEvent(event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>): Promise<NostrEvent> {
    return this.#signer().signEvent(event);
  }
}

/** Forget unlocked keys whose login has been removed. */
export function lockRemovedKeys(loggedInPubkeys: string[]) {
  const keep = new Set(loggedInPubkeys);
  for (const pubkey of [...unlocked.keys()]) {
    if (!keep.has(pubkey)) lockLocalKey(pubkey);
  }
}
