import { useCallback, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { Database, Download, Loader2, Upload } from 'lucide-react';

import { buildBackup, parseBackup } from '@/lib/noteBackup';
import { getStoredEvents, storeEvents } from '@/lib/noteStore';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BackupMenuProps {
  /** Current user's pubkey; backups are scoped to it. */
  pubkey: string;
  /** Called after a successful import so the caller can refresh the notes. */
  onImported: () => void;
}

/**
 * Export/import an encrypted local backup of the notebook.
 *
 * The file contains the signed NIP-44 ciphertext events exactly as they live on
 * relays, so it is safe to store anywhere and importing re-publishes it — a
 * full recovery path if relays drop or lose the notes.
 */
export function BackupMenu({ pubkey, onImported }: BackupMenuProps) {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const handleExport = useCallback(async () => {
    setBusy('export');
    try {
      const events = await getStoredEvents(pubkey);
      if (events.length === 0) {
        toast({
          title: 'Nothing to export yet',
          description: 'No notes are cached on this device.',
        });
        return;
      }

      const backup = buildBackup(pubkey, events);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `notebook-backup-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast({
        title: 'Backup downloaded',
        description: `${events.length} encrypted note${events.length === 1 ? '' : 's'} saved to a file.`,
      });
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  }, [pubkey, toast]);

  const handleImport = useCallback(
    async (file: File) => {
      setBusy('import');
      try {
        const { events, skipped } = parseBackup(await file.text(), pubkey);
        if (events.length === 0) {
          toast({
            title: 'Nothing to import',
            description: 'No valid notes for this account were found in that file.',
            variant: 'destructive',
          });
          return;
        }

        // Save locally first so the restore works even with no relay reachable.
        await storeEvents(pubkey, events);

        // Then re-publish to relays (best effort) so relays are repopulated too.
        const results = await Promise.allSettled(
          events.map((event) => nostr.event(event, { signal: AbortSignal.timeout(8000) })),
        );
        const republished = results.filter((result) => result.status === 'fulfilled').length;
        const failed = events.length - republished;

        onImported();

        toast({
          title: 'Backup imported',
          description: [
            `${events.length} note${events.length === 1 ? '' : 's'} restored`,
            failed > 0 ? `${failed} couldn't be re-published to relays` : null,
            skipped > 0 ? `${skipped} skipped` : null,
          ]
            .filter(Boolean)
            .join(' · ') + '.',
        });
      } catch (error) {
        toast({
          title: 'Import failed',
          description: error instanceof Error ? error.message : 'Something went wrong.',
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [nostr, pubkey, onImported, toast],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleImport(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-1.5" disabled={busy !== null}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Backup
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Encrypted local backup</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void handleExport()}>
            <Download className="h-4 w-4" />
            Export backup…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Import backup…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
