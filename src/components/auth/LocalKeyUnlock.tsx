import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getLocalKeysVersion,
  isLocalKeyLogin,
  isUnlocked,
  lockRemovedKeys,
  subscribeLocalKeys,
  unlockWithNsec,
  unlockWithPassword,
} from '@/lib/localKey';

/**
 * A secret key login keeps the key in memory only, so after a reload the
 * account is locked. Ask for the password (if the key was saved encrypted)
 * or for the nsec again, or let the user log out.
 *
 * Mount once near the app root.
 */
export function LocalKeyUnlock() {
  const { logins, removeLogin } = useNostrLogin();
  const queryClient = useQueryClient();
  useSyncExternalStore(subscribeLocalKeys, getLocalKeysVersion, getLocalKeysVersion);

  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Drop keys from memory when their login is removed (log out).
  useEffect(() => {
    lockRemovedKeys(logins.map((l) => l.pubkey));
  }, [logins]);

  const current = logins[0];
  const login = isLocalKeyLogin(current) ? current : undefined;
  const open = !!login && !isUnlocked(login.pubkey);
  const saved = typeof login?.data.ncryptsec === 'string';

  const unlock = () => {
    if (!login) return;
    setError('');
    setBusy(true);
    // Decrypting takes a moment; let the spinner paint first.
    setTimeout(() => {
      try {
        if (saved) unlockWithPassword(login, value);
        else unlockWithNsec(login, value);
        setValue('');
        // Anything that failed while locked (e.g. decrypting notes) can retry.
        queryClient.invalidateQueries();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't unlock.");
      } finally {
        setBusy(false);
      }
    }, 50);
  };

  const logOut = () => {
    if (login) removeLogin(login.id);
    setValue('');
    setError('');
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex size-14 bg-primary/10 rounded-full items-center justify-center mx-auto mb-2">
            <LockKeyhole className="w-7 h-7 text-primary" />
          </div>
          <DialogTitle className="text-center">Unlock your account</DialogTitle>
          <DialogDescription className="text-center">
            {saved
              ? 'Enter the password you set to unlock your key on this device.'
              : 'Your key is not saved on this device. Paste your nsec to continue.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            unlock();
          }}
          className="space-y-3"
        >
          <Input
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError('');
            }}
            placeholder={saved ? 'Password' : 'nsec1…'}
            autoComplete={saved ? 'current-password' : 'off'}
            aria-label={saved ? 'Password' : 'Secret key'}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !value} className="w-full rounded-full">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Unlock
          </Button>
          <Button type="button" variant="ghost" onClick={logOut} className="w-full rounded-full">
            Log out
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
