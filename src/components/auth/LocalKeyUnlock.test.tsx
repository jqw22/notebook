import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

import { TestApp } from '@/test/TestApp';
import { createLocalKeyLogin, isUnlocked, lockLocalKey } from '@/lib/localKey';
import { LocalKeyUnlock } from './LocalKeyUnlock';

afterEach(() => {
  localStorage.clear();
});

describe('LocalKeyUnlock', () => {
  it('asks for the password after a reload and unlocks the key', async () => {
    const sk = generateSecretKey();
    const pubkey = getPublicKey(sk);
    const login = createLocalKeyLogin(nip19.nsecEncode(sk), 'correct horse');
    lockLocalKey(pubkey); // as after a reload
    localStorage.setItem('test-login', JSON.stringify([login]));

    render(
      <TestApp>
        <LocalKeyUnlock />
      </TestApp>,
    );

    const input = await screen.findByLabelText('Password');
    fireEvent.change(input, { target: { value: 'wrong password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(isUnlocked(pubkey)).toBe(true));
    await waitFor(() =>
      expect(screen.queryByText('Unlock your account')).not.toBeInTheDocument(),
    );
  });

  it('logs out a locked account', async () => {
    const sk = generateSecretKey();
    const login = createLocalKeyLogin(nip19.nsecEncode(sk));
    lockLocalKey(login.pubkey);
    localStorage.setItem('test-login', JSON.stringify([login]));

    render(
      <TestApp>
        <LocalKeyUnlock />
      </TestApp>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(localStorage.getItem('test-login')).toBe('[]'));
  });
});
