import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { NLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LegacyKeyNotice } from './LegacyKeyNotice';

function CurrentPubkey() {
  const { user } = useCurrentUser();
  return <p data-testid="current">{user?.pubkey ?? 'none'}</p>;
}

afterEach(() => {
  localStorage.clear();
});

describe('LegacyKeyNotice', () => {
  it('ignores a stored nsec login, then removes it and opens the signer login', async () => {
    const sk = generateSecretKey();
    const login = NLogin.fromNsec(nip19.nsecEncode(sk));
    localStorage.setItem('test-login', JSON.stringify([login]));

    render(
      <TestApp>
        <CurrentPubkey />
        <LegacyKeyNotice />
      </TestApp>,
    );

    expect(await screen.findByText('Secret key login has been removed')).toBeInTheDocument();
    // The stored key must not be used to sign in.
    expect(screen.getByTestId('current')).toHaveTextContent('none');
    expect(getPublicKey(sk)).toBe(login.pubkey);

    fireEvent.click(screen.getByRole('button', { name: 'Remove key and log in again' }));

    await waitFor(() => {
      expect(localStorage.getItem('test-login')).toBe('[]');
    });
    expect(await screen.findByRole('button', { name: /Log in with extension/ })).toBeInTheDocument();
    expect(screen.queryByText('Secret key login has been removed')).not.toBeInTheDocument();
  });

  it('shows nothing when there is no nsec login', async () => {
    render(
      <TestApp>
        <CurrentPubkey />
        <LegacyKeyNotice />
      </TestApp>,
    );

    await screen.findByTestId('current');
    expect(screen.queryByText('Secret key login has been removed')).not.toBeInTheDocument();
  });
});
