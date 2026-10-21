import { useState } from 'react';
import { Download, KeyRound } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type NLoginType, useNostrLogin } from '@nostrify/react/login';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AuthDialog from './AuthDialog';

type NsecLogin = Extract<NLoginType, { type: 'nsec' }>;

/** Save a secret key to a text file so it can be imported into a signer. */
function downloadNsecFile(login: NsecLogin) {
  const npub = nip19.npubEncode(login.pubkey);
  const filename = `nostr-${location.hostname.replaceAll(/\./g, '-')}-${npub.slice(5, 9)}.nsec.txt`;

  const blob = new Blob([login.data.nsec], { type: 'text/plain; charset=utf-8' });
  const url = globalThis.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  globalThis.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

/**
 * Older versions of the app let users log in by pasting an nsec, which
 * stored the secret key unencrypted in localStorage. Those logins are no
 * longer used to sign anything. This notice offers a last chance to save
 * the key (notes are encrypted to it, so losing it means losing them),
 * removes it from the browser, and then opens the extension / bunker login.
 *
 * Mount once near the app root.
 */
export function LegacyKeyNotice() {
  const { logins, removeLogin } = useNostrLogin();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const nsecLogins = logins.filter((l): l is NsecLogin => l.type === 'nsec');

  const removeKeys = () => {
    for (const login of nsecLogins) {
      removeLogin(login.id);
    }
    setAuthDialogOpen(true);
  };

  return (
    <>
      <Dialog open={nsecLogins.length > 0}>
        <DialogContent
          className="sm:max-w-sm"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex size-14 bg-primary/10 rounded-full items-center justify-center mx-auto mb-2">
              <KeyRound className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="text-center">Secret key login has been removed</DialogTitle>
            <DialogDescription className="text-center">
              Your secret key is stored unencrypted in this browser, which isn't safe. It will be
              removed, and you'll log in with a signer extension or app instead.
            </DialogDescription>
          </DialogHeader>

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-900 dark:text-amber-300">
              Your notes are encrypted to this key. If you don't have a copy saved elsewhere,
              download it now and import it into your signer, or you'll lose access to your notes.
            </p>
          </div>

          <div className="space-y-2">
            {nsecLogins.map((login) => (
              <Button
                key={login.id}
                variant="outline"
                onClick={() => downloadNsecFile(login)}
                className="w-full rounded-full"
              >
                <Download className="w-4 h-4 mr-2" />
                Download key
                {nsecLogins.length > 1 && (
                  <span className="ml-1 font-mono text-xs">{shortNpub(login.pubkey)}</span>
                )}
              </Button>
            ))}
            <Button onClick={removeKeys} className="w-full rounded-full">
              Remove key and log in again
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AuthDialog isOpen={authDialogOpen} onClose={() => setAuthDialogOpen(false)} />
    </>
  );
}
