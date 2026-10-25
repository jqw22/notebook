import { describe, it, expect, vi } from 'vitest';
import { authUrlFromError, getApprovalUrl, withApproval } from './remoteSigner';

/** Pretend the user came back to the tab from their signer. */
function returnToTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('authUrlFromError', () => {
  it('reads the approval URL from an auth_url error', () => {
    expect(authUrlFromError(new Error('https://nsec.app/confirm?id=1'))).toBe(
      'https://nsec.app/confirm?id=1',
    );
  });

  it('ignores ordinary errors and non-https URLs', () => {
    expect(authUrlFromError(new Error('Subscription closed'))).toBeUndefined();
    expect(authUrlFromError(new Error('javascript:alert(1)'))).toBeUndefined();
    expect(authUrlFromError('https://nsec.app')).toBeUndefined();
  });
});

describe('withApproval', () => {
  it('passes through when no approval is needed', async () => {
    const retry = vi.fn();
    await expect(withApproval(async () => 'ok', retry)).resolves.toBe('ok');
    expect(retry).not.toHaveBeenCalled();
  });

  it('shows the approval link and retries when the user comes back', async () => {
    const result = withApproval(
      async () => {
        throw new Error('https://nsec.app/confirm?id=1');
      },
      async () => 'pubkey',
    );

    await vi.waitFor(() => expect(getApprovalUrl()).toBe('https://nsec.app/confirm?id=1'));
    returnToTab();

    await expect(result).resolves.toBe('pubkey');
    expect(getApprovalUrl()).toBeNull();
  });

  it('fails on a refusal and clears the link', async () => {
    const result = withApproval(
      async () => {
        throw new Error('https://nsec.app/confirm?id=2');
      },
      async () => {
        throw new Error('rejected by user');
      },
    );

    await vi.waitFor(() => expect(getApprovalUrl()).not.toBeNull());
    returnToTab();

    await expect(result).rejects.toThrow('rejected by user');
    expect(getApprovalUrl()).toBeNull();
  });

  it('does not wait for approval on ordinary errors', async () => {
    await expect(
      withApproval(async () => {
        throw new Error('Subscription closed');
      }, vi.fn()),
    ).rejects.toThrow('Subscription closed');
    expect(getApprovalUrl()).toBeNull();
  });
});
