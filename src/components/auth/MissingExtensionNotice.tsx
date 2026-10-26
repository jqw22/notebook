import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { useNostrLogin } from '@nostrify/react/login';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { waitForExtension } from '@/lib/extensionSigner';
import AuthDialog from './AuthDialog';

/**
 * When the current account logs in through a NIP-07 extension and no
 * extension is present (uninstalled, disabled, or another browser), nothing
 * can be signed or decrypted, and the notes page would sit loading forever.
 * Say so, and offer to log that account out and pick another login.
 *
 * Mount once near the app root.
 */
export function MissingExtensionNotice() {
  const { logins, removeLogin } = useNostrLogin();
  const current = logins[0];
  const currentId = current?.type === 'extension' ? current.id : undefined;

  const [missingFor, setMissingFor] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  useEffect(() => {
    if (!currentId) return;
    let cancelled = false;
    waitForExtension().then((present) => {
      if (!cancelled && !present) setMissingFor(currentId);
    });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  const open = missingFor !== null && missingFor === currentId;

  const logOut = () => {
    if (currentId) removeLogin(currentId);
    setMissingFor(null);
    setAuthDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open}>
        <DialogContent
          className="sm:max-w-sm"
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex size-14 bg-primary/10 rounded-full items-center justify-center mx-auto mb-2">
              <Puzzle className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="text-center">Signer extension not found</DialogTitle>
            <DialogDescription className="text-center">
              This account logs in through a browser extension, but there isn't one in this
              browser. Turn it back on and reload, or log this account out and log in another
              way. Your notes stay safe on your relays.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button onClick={logOut} className="w-full rounded-full">
              Log out and log in another way
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="w-full rounded-full"
            >
              Reload
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AuthDialog isOpen={authDialogOpen} onClose={() => setAuthDialogOpen(false)} />
    </>
  );
}
