/*
 * Encrypt a secret key so that only a passkey (Face ID / Touch ID) can
 * unlock it, using the WebAuthn PRF extension. The authenticator turns a
 * stored salt into a secret that never leaves the device's secure hardware
 * without user verification; we derive an AES-GCM key from it with HKDF.
 * Unlike a short PIN, the encrypted blob can't be brute-forced offline,
 * because guessing requires the authenticator itself.
 */

export interface PasskeyLock {
  /** WebAuthn credential id (base64url). */
  credentialId: string;
  /** PRF input (base64url). */
  salt: string;
  /** AES-GCM nonce (base64url). */
  iv: string;
  /** AES-GCM encrypted secret key (base64url). */
  ciphertext: string;
}

export class PasskeyUnsupportedError extends Error {
  constructor() {
    super(
      "Face ID unlock needs a passkey saved in Apple Passwords (iCloud Keychain). " +
        "Password managers such as Bitwarden can't do this yet. Use a password instead, " +
        'or try again and choose Passwords when asked where to save the passkey.',
    );
    this.name = 'PasskeyUnsupportedError';
  }
}

const HKDF_INFO = new TextEncoder().encode('simple-notebook passkey lock v1');

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Whether this browser has WebAuthn at all (PRF support is only known after trying). */
export function passkeysAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
    && !!navigator.credentials;
}

async function aesKey(prfOutput: ArrayBuffer, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Ask the passkey for its PRF output for `salt`. */
async function evaluate(credentialId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>) {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const output = (assertion?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results
    ?.first;
  if (!output) throw new PasskeyUnsupportedError();
  return output;
}

/**
 * Create a passkey for this account and encrypt `sk` with it. Must be called
 * from a tap (browsers only allow passkey prompts on user action).
 */
export async function createPasskeyLock(
  sk: Uint8Array,
  account: { pubkey: string; label: string },
): Promise<PasskeyLock> {
  if (!passkeysAvailable()) throw new PasskeyUnsupportedError();
  const salt = random(32);

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'My Notes', id: location.hostname },
      user: { id: random(16), name: account.label, displayName: account.label },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      // Prefer the device's own keychain: some password managers (e.g.
      // Bitwarden) save passkeys without the PRF extension we need.
      hints: ['client-device'],
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!credential) throw new PasskeyUnsupportedError();

  const credentialId = new Uint8Array(credential.rawId);
  const results = credential.getClientExtensionResults() as PrfResults;
  if (results.prf?.enabled === false) throw new PasskeyUnsupportedError();

  // Some platforms return the PRF output at creation; others only on use.
  const output = results.prf?.results?.first ?? (await evaluate(credentialId, salt));

  const iv = random(12);
  const key = await aesKey(output, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(sk)),
  );

  return {
    credentialId: toB64(credentialId),
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
  };
}

/** Unlock with the passkey (shows Face ID / Touch ID). Must be called from a tap. */
export async function openPasskeyLock(lock: PasskeyLock): Promise<Uint8Array> {
  if (!passkeysAvailable()) throw new PasskeyUnsupportedError();
  const salt = fromB64(lock.salt);
  const output = await evaluate(fromB64(lock.credentialId), salt);
  const key = await aesKey(output, salt);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(lock.iv) },
      key,
      fromB64(lock.ciphertext),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error("Couldn't unlock with this passkey.");
  }
}
