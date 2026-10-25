import { useSyncExternalStore } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getApprovalUrl, subscribeApprovalUrl } from '@/lib/remoteSigner';

/**
 * Shown when a remote signer (e.g. nsec.app) asks the user to approve a
 * request. The link has to be a real tap: mobile Safari blocks pop-ups
 * opened from async code. The request is retried when the user comes back.
 *
 * Mount once near the app root.
 */
export function SignerApprovalPrompt() {
  const url = useSyncExternalStore(subscribeApprovalUrl, getApprovalUrl, () => null);

  return (
    <Dialog open={url !== null}>
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex size-14 bg-primary/10 rounded-full items-center justify-center mx-auto mb-2">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>
          <DialogTitle className="text-center">Approve in your signer</DialogTitle>
          <DialogDescription className="text-center">
            Your signer needs you to approve this request. Open it, approve, then come back to
            this tab. The app will carry on by itself.
          </DialogDescription>
        </DialogHeader>
        {url && (
          <Button asChild className="w-full rounded-full">
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open signer to approve
            </a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
