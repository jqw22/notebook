import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { useNostrLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { useLoginActions } from './useLoginActions';

/** Stub a NIP-07 extension at `window.nostr` that reports `pubkey`. */
function stubExtension(pubkey: string) {
  (globalThis as { nostr?: unknown }).nostr = {
    getPublicKey: async () => pubkey,
  };
}

afterEach(() => {
  delete (globalThis as { nostr?: unknown }).nostr;
  localStorage.clear();
});

describe('useLoginActions', () => {
  it('has no nsec login method', async () => {
    const { result } = renderHook(() => useLoginActions(), { wrapper: TestApp });
    // NostrLoginProvider renders null while it reads logins from storage.
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).not.toHaveProperty('nsec');
  });

  /**
   * Regression test: adding a second login while one is already logged in
   * must switch the current user to the new login (logins[0]). Without the
   * fix, addLogin appends the new login to the end of the array and
   * logins[0] remains the previously-logged-in user.
   */
  it('promotes the newly added login to logins[0]', async () => {
    const pubkey1 = getPublicKey(generateSecretKey());
    const pubkey2 = getPublicKey(generateSecretKey());

    const { result } = renderHook(
      () => ({
        actions: useLoginActions(),
        login: useNostrLogin(),
      }),
      { wrapper: TestApp },
    );

    // NostrLoginProvider renders null while it reads logins from storage,
    // so wait for the provider to mount.
    await waitFor(() => expect(result.current).not.toBeNull());

    stubExtension(pubkey1);
    await act(() => result.current.actions.extension());
    expect(result.current.login.logins).toHaveLength(1);

    stubExtension(pubkey2);
    await act(() => result.current.actions.extension());

    expect(result.current.login.logins).toHaveLength(2);
    // The newly added login MUST be at index 0 (current user).
    expect(result.current.login.logins[0].pubkey).toBe(pubkey2);
  });
});
