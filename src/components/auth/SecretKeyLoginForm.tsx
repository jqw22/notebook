import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLoginActions } from '@/hooks/useLoginActions';
import { MIN_PASSWORD_LENGTH } from '@/lib/localKey';
import { PasskeyUnsupportedError, passkeysAvailable } from '@/lib/passkeyLock';

interface SecretKeyLoginFormProps {
  /** An nsec to start with (e.g. one pasted into the bunker field). */
  initialNsec?: string;
  onLoggedIn: () => void;
}

/** How the key is kept on this device after logging in. */
type Remember = 'passkey' | 'password' | 'none';

const REMEMBER_HINT: Record<Remember, string> = {
  passkey:
    "Your key is saved encrypted and unlocked with Face ID or Touch ID once per visit.",
  password: "Your key is saved encrypted. You'll enter this password once per visit.",
  none: "Your key is kept only while this tab is open. You'll paste it again next time.",
};

/**
 * Log in by pasting an nsec. The key is kept in memory only. It can also be
 * saved on this device encrypted with a passkey (Face ID / Touch ID) or a
 * password (NIP-49), to be unlocked on later visits.
 */
export const SecretKeyLoginForm: React.FC<SecretKeyLoginFormProps> = ({
  initialNsec = '',
  onLoggedIn,
}) => {
  const login = useLoginActions();
  const [nsec, setNsec] = useState(initialNsec);
  const [remember, setRemember] = useState<Remember>(
    passkeysAvailable() ? 'passkey' : 'password',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const done = () => {
    setNsec('');
    setPassword('');
    setConfirm('');
    onLoggedIn();
  };

  const fail = (e: unknown) => {
    if (e instanceof PasskeyUnsupportedError) setRemember('password');
    // A cancelled Face ID prompt surfaces as NotAllowedError.
    const cancelled = e instanceof DOMException && e.name === 'NotAllowedError';
    setError(
      cancelled
        ? 'Face ID was cancelled. Try again, or choose another option.'
        : e instanceof Error
          ? e.message
          : "Couldn't log in with this key.",
    );
    setBusy(false);
  };

  const submit = () => {
    setError('');

    if (remember === 'passkey') {
      // Start the passkey prompt straight from the tap: browsers refuse
      // passkey prompts that aren't triggered by the user.
      setBusy(true);
      login.localKeyWithPasskey(nsec).then(done, fail);
      return;
    }

    if (remember === 'password') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The passwords don't match.");
        return;
      }
    }
    setBusy(true);
    // Encrypting the key takes a moment; let the spinner paint first.
    setTimeout(() => {
      try {
        login.localKey(nsec, remember === 'password' ? password : undefined);
        done();
      } catch (e) {
        fail(e);
      }
    }, 50);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3"
    >
      <Input
        type="password"
        value={nsec}
        onChange={(e) => {
          setNsec(e.target.value);
          if (error) setError('');
        }}
        placeholder="nsec1…"
        autoComplete="off"
        aria-label="Secret key"
      />

      <RadioGroup
        value={remember}
        onValueChange={(value) => {
          setRemember(value as Remember);
          setError('');
        }}
        className="gap-2 text-sm"
        aria-label="Remember on this device"
      >
        {passkeysAvailable() && (
          <label className="flex items-center gap-2">
            <RadioGroupItem value="passkey" />
            Remember, unlock with Face ID / Touch ID
          </label>
        )}
        <label className="flex items-center gap-2">
          <RadioGroupItem value="password" />
          Remember, unlock with a password
        </label>
        <label className="flex items-center gap-2">
          <RadioGroupItem value="none" />
          Don't remember
        </label>
      </RadioGroup>

      {remember === 'password' && (
        <div className="space-y-2">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="new-password"
            aria-label="Password"
          />
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            aria-label="Confirm password"
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {REMEMBER_HINT[remember]} It never leaves this browser.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy || !nsec.trim()} className="w-full rounded-full">
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {busy ? 'Logging in…' : 'Log in with secret key'}
      </Button>
    </form>
  );
};
