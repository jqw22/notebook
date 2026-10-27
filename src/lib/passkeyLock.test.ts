import { describe, it, expect, afterEach, vi } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { PasskeyUnsupportedError, createPasskeyLock, openPasskeyLock } from './passkeyLock';
import {
  createLocalKeyLoginWithPasskey,
  isUnlocked,
  lockLocalKey,
  unlockWithPasskey,
} from './localKey';

/**
 * Fake authenticator: the PRF output is a fixed function of the credential
 * and the salt, like a real one. `prfAtCreate` controls whether creation
 * already returns the output; `prf: false` acts like a browser without PRF.
 */
function fakeAuthenticator({ prf = true, prfAtCreate = true } = {}) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const output = async (salt: BufferSource) => {
    const data = new Uint8Array([...secret, ...new Uint8Array(salt as ArrayBuffer)]);
    return crypto.subtle.digest('SHA-256', data);
  };
  const rawId = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const saltOf = (opts: CredentialCreationOptions | CredentialRequestOptions) =>
    (opts.publicKey!.extensions as { prf: { eval: { first: BufferSource } } }).prf.eval.first;

  // Resolve PRF results eagerly so getClientExtensionResults stays synchronous.
  const credentials = {
    create: vi.fn(async (opts: CredentialCreationOptions) => {
      const first = prf && prfAtCreate ? await output(saltOf(opts)) : undefined;
      return {
        rawId,
        getClientExtensionResults: () =>
          prf ? { prf: { enabled: true, results: first ? { first } : undefined } } : {},
      };
    }),
    get: vi.fn(async (opts: CredentialRequestOptions) => {
      const first = prf ? await output(saltOf(opts)) : undefined;
      return {
        rawId,
        getClientExtensionResults: () => (prf ? { prf: { results: { first } } } : {}),
      };
    }),
  };
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true });
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
  return credentials;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('passkey lock', () => {
  it('round-trips a secret key through the passkey', async () => {
    fakeAuthenticator();
    const sk = generateSecretKey();
    const lock = await createPasskeyLock(sk, { pubkey: getPublicKey(sk), label: 'test' });

    expect(JSON.stringify(lock)).not.toContain(nip19.nsecEncode(sk));
    expect(await openPasskeyLock(lock)).toEqual(sk);
  });

  it('asks the passkey again when creation returns no PRF output', async () => {
    const credentials = fakeAuthenticator({ prfAtCreate: false });
    const sk = generateSecretKey();
    const lock = await createPasskeyLock(sk, { pubkey: getPublicKey(sk), label: 'test' });

    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(await openPasskeyLock(lock)).toEqual(sk);
  });

  it('reports browsers without PRF support', async () => {
    fakeAuthenticator({ prf: false, prfAtCreate: false });
    const sk = generateSecretKey();
    await expect(
      createPasskeyLock(sk, { pubkey: getPublicKey(sk), label: 'test' }),
    ).rejects.toBeInstanceOf(PasskeyUnsupportedError);
  });

  it('saves a login that only the passkey can unlock', async () => {
    fakeAuthenticator();
    const sk = generateSecretKey();
    const nsec = nip19.nsecEncode(sk);
    const login = await createLocalKeyLoginWithPasskey(nsec);

    expect(JSON.stringify(login)).not.toContain(nsec);
    expect(login.data.ncryptsec).toBeUndefined();

    lockLocalKey(login.pubkey);
    await unlockWithPasskey(login);
    expect(isUnlocked(login.pubkey)).toBe(true);
  });
});
