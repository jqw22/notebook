import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NLogin } from '@nostrify/react/login';

import { TestApp } from '@/test/TestApp';
import { MissingExtensionNotice } from './MissingExtensionNotice';

const pubkey = 'a'.repeat(64);

afterEach(() => {
  delete (globalThis as { nostr?: unknown }).nostr;
  localStorage.clear();
});

describe('MissingExtensionNotice', () => {
  it('offers to log out an extension account when there is no extension', async () => {
    localStorage.setItem('test-login', JSON.stringify([new NLogin('extension', pubkey, null)]));

    render(
      <TestApp>
        <MissingExtensionNotice />
      </TestApp>,
    );

    const logOut = await screen.findByRole(
      'button',
      { name: 'Log out and log in another way' },
      { timeout: 5000 },
    );
    fireEvent.click(logOut);

    await waitFor(() => expect(localStorage.getItem('test-login')).toBe('[]'));
    expect(await screen.findByRole('button', { name: /Connect a signer app/ })).toBeInTheDocument();
  });

  it('stays hidden when the extension is present', async () => {
    (globalThis as { nostr?: unknown }).nostr = { getPublicKey: async () => pubkey };
    localStorage.setItem('test-login', JSON.stringify([new NLogin('extension', pubkey, null)]));

    render(
      <TestApp>
        <MissingExtensionNotice />
      </TestApp>,
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByText('Signer extension not found')).not.toBeInTheDocument();
  });
});
