import {
  BunkerURI,
  NConnectSigner,
  NSecSigner,
  type NostrEvent,
  type NostrSigner,
  type NRelay,
} from '@nostrify/nostrify';
import { NLogin, type NLoginType } from '@nostrify/react/login';
import { generateSecretKey, nip19 } from 'nostr-tools';

/*
 * NIP-46 signers such as nsec.app answer a request they need the user to
 * approve with `{ result: "auth_url", error: "<url>" }`. NConnectSigner turns
 * that into an Error whose message is the URL, so the login or the save just
 * fails. Here we spot that, show the user the approval link, and retry the
 * request once they have approved it.
 */

/** How long to wait for the user to approve a request in their signer. */
const APPROVAL_TIMEOUT_MS = 3 * 60 * 1000;
/** Retry this often while waiting, and also whenever the tab comes back. */
const RETRY_INTERVAL_MS = 15 * 1000;
/** Timeout for each retry, so a dropped request doesn't stall the loop. */
const PROBE_TIMEOUT_MS = 10 * 1000;

type Listener = (url: string | null) => void;
const listeners = new Set<Listener>();
let pendingApprovalUrl: string | null = null;

function setPendingApprovalUrl(url: string | null) {
  pendingApprovalUrl = url;
  for (const listener of listeners) listener(url);
}

/** Subscribe to the approval link the user currently needs to open, if any. */
export function subscribeApprovalUrl(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getApprovalUrl(): string | null {
  return pendingApprovalUrl;
}

/** The approval URL from an auth_url response, or undefined for any other error. */
export function authUrlFromError(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  try {
    const url = new URL(error.message.trim());
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve after the retry interval, or as soon as the tab becomes visible again. */
function waitForRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      signal?.removeEventListener('abort', onAbort);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        done();
        resolve();
      }
    };
    const onAbort = () => {
      done();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, RETRY_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Run `first`. If the signer asks for approval, show the link and keep
 * calling `retry` until the signer accepts, refuses, or time runs out.
 */
export async function withApproval<T>(
  first: () => Promise<T>,
  retry: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await first();
  } catch (error) {
    const url = authUrlFromError(error);
    if (!url) throw error;
    setPendingApprovalUrl(url);
  }

  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      await waitForRetry(signal);
      try {
        return await retry();
      } catch (error) {
        const url = authUrlFromError(error);
        // A timeout here usually means the signer isn't running yet
        // (e.g. its tab is asleep); keep waiting rather than failing.
        const timedOut = error instanceof Error && /timeout|timed out|abort/i.test(error.message);
        if (!url && !timedOut) throw error;
        if (url) setPendingApprovalUrl(url);
      }
    }
    throw new Error('Timed out waiting for approval in your signer.');
  } finally {
    setPendingApprovalUrl(null);
  }
}

function connectSigner(relay: NRelay, bunkerPubkey: string, clientSk: Uint8Array, timeout: number) {
  return new NConnectSigner({
    relay,
    pubkey: bunkerPubkey,
    signer: new NSecSigner(clientSk),
    timeout,
  });
}

/**
 * A NIP-46 signer that handles auth_url approval requests. Drop-in
 * replacement for the NConnectSigner that NUser.fromBunkerLogin builds.
 */
export class RemoteSigner implements NostrSigner {
  readonly #signer: NConnectSigner;
  readonly #probe: NConnectSigner;

  readonly nip44: NonNullable<NostrSigner['nip44']>;
  readonly nip04: NonNullable<NostrSigner['nip04']>;

  constructor(relay: NRelay, bunkerPubkey: string, clientSk: Uint8Array) {
    this.#signer = connectSigner(relay, bunkerPubkey, clientSk, 60_000);
    this.#probe = connectSigner(relay, bunkerPubkey, clientSk, PROBE_TIMEOUT_MS);

    const call = <T>(fn: (s: NConnectSigner) => Promise<T>) =>
      withApproval(() => fn(this.#signer), () => fn(this.#probe));

    this.nip44 = {
      encrypt: (pubkey, plaintext) => call((s) => s.nip44.encrypt(pubkey, plaintext)),
      decrypt: (pubkey, ciphertext) => call((s) => s.nip44.decrypt(pubkey, ciphertext)),
    };
    this.nip04 = {
      encrypt: (pubkey, plaintext) => call((s) => s.nip04.encrypt(pubkey, plaintext)),
      decrypt: (pubkey, ciphertext) => call((s) => s.nip04.decrypt(pubkey, ciphertext)),
    };
    this.getPublicKey = () => call((s) => s.getPublicKey());
    this.signEvent = (event) => call((s) => s.signEvent(event));
    this.getRelays = () => call((s) => s.getRelays());
  }

  getPublicKey: () => Promise<string>;
  signEvent: (event: Omit<NostrEvent, 'id' | 'pubkey' | 'sig'>) => Promise<NostrEvent>;
  getRelays: () => Promise<Record<string, { read: boolean; write: boolean }>>;

  /** Build the signer for a saved bunker login. */
  static fromLogin(login: Extract<NLoginType, { type: 'bunker' }>, pool: { group(urls: string[]): NRelay }) {
    const decoded = nip19.decode(login.data.clientNsec);
    if (decoded.type !== 'nsec') throw new Error('Invalid bunker login');
    return new RemoteSigner(pool.group(login.data.relays), login.data.bunkerPubkey, decoded.data);
  }
}

/**
 * Log in with a bunker:// URI. Same result as NLogin.fromBunker, but if the
 * signer asks the user to approve the connection, the approval link is
 * shown and we wait for it. After approval, a retry of `connect` may be
 * refused because its one-time secret was already used, so the retry asks
 * for the public key instead: an answer means the connection was approved.
 */
export async function loginWithBunker(
  uri: string,
  pool: { group(urls: string[]): NRelay },
  signal?: AbortSignal,
): Promise<NLoginType> {
  const { pubkey: bunkerPubkey, secret, relays } = new BunkerURI(uri);
  if (!relays.length) throw new Error('No relay provided');

  const clientSk = generateSecretKey();
  const relay = pool.group(relays);
  const signer = connectSigner(relay, bunkerPubkey, clientSk, 60_000);
  const probe = connectSigner(relay, bunkerPubkey, clientSk, PROBE_TIMEOUT_MS);

  const pubkey = await withApproval(
    async () => {
      await signer.connect(secret);
      return signer.getPublicKey();
    },
    () => probe.getPublicKey(),
    signal,
  );

  return new NLogin('bunker', pubkey, {
    bunkerPubkey,
    clientNsec: nip19.nsecEncode(clientSk),
    relays,
  }) as NLoginType;
}
