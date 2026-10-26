import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useLoginActions } from '@/hooks/useLoginActions';
import { MIN_PASSWORD_LENGTH } from '@/lib/localKey';

interface SecretKeyLoginFormProps {
  /** An nsec to start with (e.g. one pasted into the bunker field). */
  initialNsec?: string;
  onLoggedIn: () => void;
}

/**
 * Log in by pasting an nsec. The key is kept in memory only. If the user
 * ticks "remember", it is also saved on this device encrypted with their
 * password (NIP-49), and unlocked with that password on later visits.
 */
export const SecretKeyLoginForm: React.FC<SecretKeyLoginFormProps> = ({
  initialNsec = '',
  onLoggedIn,
}) => {
  const login = useLoginActions();
  const [nsec, setNsec] = useState(initialNsec);
  const [remember, setRemember] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setError('');
    if (remember) {
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
        login.localKey(nsec, remember ? password : undefined);
        setNsec('');
        setPassword('');
        setConfirm('');
        onLoggedIn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't log in with this key.");
        setBusy(false);
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

      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={remember}
          onCheckedChange={(checked) => setRemember(checked === true)}
          className="mt-0.5"
        />
        <span>Remember on this device, locked with a password</span>
      </label>

      {remember && (
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
        {remember
          ? "Your key is saved only in encrypted form. You'll enter this password once per visit."
          : "Your key is kept only while this tab is open. You'll paste it again next time."}{' '}
        It never leaves this browser.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy || !nsec.trim()} className="w-full rounded-full">
        {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {busy ? 'Logging in…' : 'Log in with secret key'}
      </Button>
    </form>
  );
};
