import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, ExternalLink, Puzzle, Copy, Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SecretKeyLoginForm } from './SecretKeyLoginForm';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  useLoginActions,
  generateNostrConnectParams,
  generateNostrConnectURI,
  type NostrConnectParams,
  type NostrConnectStatus,
} from '@/hooks/useLoginActions';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// A pasted nsec goes to SecretKeyLoginForm, which keeps the key in memory and
// saves it only encrypted with the user's password.
const looksLikeNsec = (value: string) => value.startsWith('nsec1');
const validateBunkerUri = (uri: string) => uri.startsWith('bunker://');

/** Signers we point new users to. Hard-coded https links only. */
const SIGNER_LINKS = [
  { name: 'Alby', href: 'https://getalby.com/', kind: 'extension' },
  { name: 'nos2x', href: 'https://github.com/fiatjaf/nos2x', kind: 'extension' },
  { name: 'Nostash', href: 'https://apps.apple.com/app/nostash/id6744309333', kind: 'Safari extension for iPhone and iPad' },
  { name: 'Amber', href: 'https://github.com/greenart7c3/Amber', kind: 'Android app' },
  { name: 'nsec.app', href: 'https://nsec.app/', kind: 'bunker, works in any browser' },
] as const;

const connectStatusLabel = (status: NostrConnectStatus | null): string => {
  switch (status) {
    case 'awaiting-connect':
      return 'Waiting for signer connection…';
    case 'getting-public-key':
      return 'Getting public key…';
    default:
      return '';
  }
};

/** Whether a NIP-07 provider has been injected at `window.nostr`. */
function hasNip07Extension(): boolean {
  return typeof window !== 'undefined' && 'nostr' in window && !!(window as { nostr?: unknown }).nostr;
}

const AuthDialog: React.FC<AuthDialogProps> = ({ isOpen, onClose }) => {
  // Extension state
  const [isExtensionLoggingIn, setIsExtensionLoggingIn] = useState(false);
  const [extensionError, setExtensionError] = useState('');

  // Bunker state — a single input accepting a bunker:// URI.
  const [bunkerInput, setBunkerInput] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Nostrconnect ("Open signer app") state. No QR code is shown — the URI is
  // launched directly on the device and the app listens for the handshake.
  const [nostrConnectParams, setNostrConnectParams] = useState<NostrConnectParams | null>(null);
  const [nostrConnectUri, setNostrConnectUri] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);
  // Progress status for the nostrconnect handshake. `null` means the user
  // hasn't launched the signer yet (or they canceled).
  const [connectStatus, setConnectStatus] = useState<NostrConnectStatus | null>(null);
  // Whether the user has launched the signer app. Until then we show the
  // login options; once launched we swap in the progress view.
  const [hasOpenedSigner, setHasOpenedSigner] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Secret key ("nsec") login, collapsed by default.
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [pastedNsec, setPastedNsec] = useState('');

  const login = useLoginActions();
  // Stable refs so the nostrconnect listening effect below doesn't restart on
  // every parent render. Parents typically pass inline arrow functions for
  // onClose, and useLoginActions returns a fresh object each render — without
  // stable refs, an effect depending on them would tear down the in-flight
  // subscription on every render and cause approved logins to be swallowed.
  const loginRef = useRef(login);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    loginRef.current = login;
  }, [login]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Reset state when the dialog closes.
  // This is the "reset state when a prop changes" pattern; the usual
  // React-preferred alternative is a `key` prop on the caller, but the
  // public API of this component is a simple open/close boolean, so we
  // reset here. The multiple setState calls are intentional.
  useEffect(() => {
    if (!isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setIsExtensionLoggingIn(false);
      setExtensionError('');
      setBunkerInput('');
      setIsLoggingIn(false);
      setLoginError('');
      setNostrConnectParams(null);
      setNostrConnectUri('');
      setConnectError(null);
      setConnectStatus(null);
      setHasOpenedSigner(false);
      setLinkCopied(false);
      setShowKeyForm(false);
      setPastedNsec('');
      /* eslint-enable react-hooks/set-state-in-effect */
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  // Generate a nostrconnect session and return its URI. The listening effect
  // (keyed on the params) handles the handshake once params are set.
  const generateConnectSession = useCallback((): string => {
    const relayUrls = login.getRelayUrls();
    const params = generateNostrConnectParams(relayUrls);
    // No `callback`: the app has no page to land on after approval, and a
    // redirect would reload the app and drop the handshake in progress.
    const uri = generateNostrConnectURI(params, { name: 'Simple Notebook' });
    setNostrConnectParams(params);
    setNostrConnectUri(uri);
    setConnectError(null);
    return uri;
  }, [login]);

  // Start listening for a nostrconnect response once params are set.
  //
  // Deps are intentionally limited to `nostrConnectParams` so that parent
  // re-renders (which produce fresh onClose closures and a fresh `login`
  // object from useLoginActions) do NOT tear down an in-flight
  // subscription. An earlier version used a `cancelled` flag flipped by
  // the effect's cleanup, which caused a successful nostrconnect response
  // to be silently swallowed after the signer approved — the subscription
  // was re-created mid-handshake and the first instance's success branch
  // saw `cancelled === true`.
  //
  // Cancellation is handled explicitly by the `isOpen` effect (on dialog
  // close) and by handleConnectRetry() (on user cancel/retry).
  useEffect(() => {
    if (!nostrConnectParams) return;

    const startListening = async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        await loginRef.current.nostrconnect(
          nostrConnectParams,
          controller.signal,
          (status) => {
            if (controller.signal.aborted) return;
            setConnectStatus(status);
          },
        );
        // If the dialog was explicitly closed (handled by the isOpen
        // effect, which aborts the controller), don't try to re-close it.
        // Otherwise the user is logged in — close the dialog.
        if (controller.signal.aborted) return;
        onCloseRef.current();
      } catch (error) {
        // AbortError means we intentionally aborted (dialog closed or retry)
        if (error instanceof Error && error.name === 'AbortError') return;
        if (controller.signal.aborted) return;
        console.error('Nostrconnect failed:', error);
        setConnectStatus(null);
        setConnectError(error instanceof Error ? error.message : String(error));
      }
    };

    startListening();

    // No cleanup here: we do NOT want a re-render-triggered effect teardown
    // to cancel the in-flight subscription.
  }, [nostrConnectParams]);

  const handleConnectRetry = useCallback(() => {
    abortControllerRef.current?.abort();
    setNostrConnectParams(null);
    setNostrConnectUri('');
    setConnectError(null);
    setConnectStatus(null);
    setHasOpenedSigner(false);
  }, []);

  // Launch a remote signer app via nostrconnect. Generates the session (if
  // needed) and navigates to the URI; the listening effect handles the
  // handshake. No QR code is shown.
  // Start a nostrconnect session. We don't navigate to the URI here: on a
  // device with no app registered for nostrconnect:// (e.g. iPhone) that
  // just fails. The progress view offers an "Open" link and a copy button
  // so the link can also be pasted into a web signer such as nsec.app.
  const handleOpenSignerApp = () => {
    setLoginError('');
    setHasOpenedSigner(true);
    setLinkCopied(false);
    if (!nostrConnectUri) generateConnectSession();
  };

  const handleCopyConnectLink = async () => {
    try {
      await navigator.clipboard.writeText(nostrConnectUri);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  };

  // Log in with a NIP-07 browser extension.
  const handleExtensionLogin = async () => {
    setIsExtensionLoggingIn(true);
    setExtensionError('');
    try {
      await login.extension();
      onClose();
    } catch (e) {
      setExtensionError(e instanceof Error ? e.message : 'Extension login failed.');
      setIsExtensionLoggingIn(false);
    }
  };

  // Log in with a NIP-46 bunker:// URI.
  const handleBunkerLogin = () => {
    const value = bunkerInput.trim();
    if (!value) {
      setLoginError('Enter a bunker://… URI.');
      return;
    }

    if (looksLikeNsec(value)) {
      // Hand a pasted secret key to the secret key form instead.
      setBunkerInput('');
      setPastedNsec(value);
      setShowKeyForm(true);
      return;
    }

    if (!validateBunkerUri(value)) {
      setLoginError('Enter a valid bunker://… URI.');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');
    login
      .bunker(value)
      .then(() => onClose())
      .catch((error) => {
        const reason = error instanceof Error ? ` (${error.message})` : '';
        setLoginError(`Failed to connect. Check the bunker URI and that your signer is open.${reason}`);
        setIsLoggingIn(false);
      });
  };

  const extensionAvailable = hasNip07Extension();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-sm max-h-[90dvh] p-0 gap-0 overflow-hidden rounded-2xl overflow-y-auto">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-lg font-semibold leading-none tracking-tight text-center">
            Log in
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-5">
          {connectError ? (
            <div className="flex flex-col items-center space-y-3 py-4">
              <p className="text-sm text-destructive text-center">{connectError}</p>
              <Button variant="outline" onClick={handleConnectRetry} className="rounded-full">
                Try again
              </Button>
            </div>
          ) : hasOpenedSigner ? (
            <div className="flex flex-col items-center space-y-4 py-6 w-full">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground text-center min-h-[1.25rem]">
                {connectStatusLabel(connectStatus) || 'Waiting for your signer…'}
              </p>
              {nostrConnectUri && connectStatus !== 'getting-public-key' && (
                <div className="w-full space-y-2">
                  <Button asChild className="w-full rounded-full">
                    <a href={nostrConnectUri}>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Open in signer app
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCopyConnectLink}
                    className="w-full rounded-full"
                  >
                    {linkCopied ? (
                      <Check className="w-4 h-4 mr-2" />
                    ) : (
                      <Copy className="w-4 h-4 mr-2" />
                    )}
                    {linkCopied ? 'Copied' : 'Copy connection link'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    No signer app on this device? Copy the link and paste it into your signer
                    (for example nsec.app's "Connect app"), then come back here.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={handleConnectRetry}
                className="text-sm text-primary hover:underline underline-offset-4 font-medium"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {/* NIP-07 browser extension. */}
              <div className="space-y-2">
                <Button
                  onClick={handleExtensionLogin}
                  disabled={!extensionAvailable || isExtensionLoggingIn}
                  className="w-full h-12 rounded-full"
                >
                  {isExtensionLoggingIn ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Puzzle className="w-4 h-4 mr-2" />
                  )}
                  {isExtensionLoggingIn ? 'Logging in…' : 'Log in with extension'}
                </Button>
                {extensionAvailable && (
                  <p className="text-xs text-muted-foreground text-center">
                    Uses the account that's active in your extension. To use another one, switch
                    accounts in the extension.
                  </p>
                )}
                {!extensionAvailable && (
                  <p className="text-xs text-muted-foreground text-center">
                    No signer extension found in this browser.
                  </p>
                )}
                {extensionError && (
                  <p className="text-sm text-destructive text-center" role="alert">
                    {extensionError}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or use a remote signer
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* NIP-46 remote signer: bunker URI or nostrconnect. */}
              <BunkerLoginForm
                bunkerInput={bunkerInput}
                setBunkerInput={setBunkerInput}
                loginError={loginError}
                setLoginError={setLoginError}
                isLoggingIn={isLoggingIn}
                onSubmit={handleBunkerLogin}
              />

              <Button
                variant="outline"
                onClick={handleOpenSignerApp}
                className="w-full rounded-full"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Connect a signer app
              </Button>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or use your secret key
                <div className="h-px flex-1 bg-border" />
              </div>

              {showKeyForm ? (
                <SecretKeyLoginForm key={pastedNsec} initialNsec={pastedNsec} onLoggedIn={onClose} />
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowKeyForm(true)}
                  className="w-full rounded-full"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Paste secret key (nsec)
                </Button>
              )}

              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <p className="text-xs font-medium">New to Nostr? Get a signer first:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {SIGNER_LINKS.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline underline-offset-4"
                      >
                        {link.name}
                      </a>{' '}
                      ({link.kind})
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Your key stays in the signer. This app never sees or stores it.
                </p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** Bunker URI input + submit. */
interface BunkerLoginFormProps {
  bunkerInput: string;
  setBunkerInput: (v: string) => void;
  loginError: string;
  setLoginError: (v: string) => void;
  isLoggingIn: boolean;
  onSubmit: () => void;
}

const BunkerLoginForm: React.FC<BunkerLoginFormProps> = ({
  bunkerInput,
  setBunkerInput,
  loginError,
  setLoginError,
  isLoggingIn,
  onSubmit,
}) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      onSubmit();
    }}
    className="space-y-3"
  >
    <Input
      value={bunkerInput}
      onChange={(e) => {
        setBunkerInput(e.target.value);
        if (loginError) setLoginError('');
      }}
      placeholder="bunker://…"
      autoComplete="off"
      className={loginError ? 'border-destructive focus-visible:ring-destructive' : ''}
    />
    {loginError && <p className="text-sm text-destructive">{loginError}</p>}

    <Button
      type="submit"
      disabled={isLoggingIn || !bunkerInput.trim()}
      className="w-full rounded-full"
    >
      {isLoggingIn ? 'Connecting…' : 'Connect bunker'}
    </Button>
  </form>
);

export default AuthDialog;
