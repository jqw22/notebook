import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { getStoredEvents, mergeEvents, requestPersistentStorage, storeEvents } from '@/lib/noteStore';
import { useCurrentUser } from './useCurrentUser';

/** The decrypted payload stored in the event content. */
export interface NoteData {
  title: string;
  content: string;
  updated_at: number;
  /** Optional follow-up date as a Unix timestamp (seconds). */
  follow_up_date?: number;
}

/** A fully resolved encrypted note. */
export interface EncryptedNote {
  event: NostrEvent;
  data: NoteData;
  /** Tags extracted from the event's `t` tags (cleartext). */
  tags: string[];
}

/** Parameters for saving a note. */
export interface SaveNoteParams {
  id: string;
  title: string;
  content: string;
  tags: string[];
  /** Optional follow-up date as a Unix timestamp (seconds), or null to clear. */
  follow_up_date?: number | null;
}

const NOTE_KIND = 30078;
const ALT_DESCRIPTION = 'Encrypted Simple Notebook entry';

/**
 * Safety timeout for the relay read. If a relay socket hangs without ever
 * responding, we abandon the fetch and fall back to the local cache rather
 * than leaving the notebook stuck on its loading state.
 */
const RELAY_FETCH_TIMEOUT_MS = 8000;

/**
 * Query key for the user's encrypted notes.
 *
 * The leading `'nostr'` segment is required so that the app-wide
 * `queryClient.invalidateQueries({ queryKey: ['nostr'] })` call in
 * NostrProvider (fired whenever the relay list changes, e.g. after NIP-65
 * sync on login) also invalidates and refetches this query. Without it, the
 * notes query could run against the default relays, never refetch once the
 * user's own relays load, and show an empty notebook.
 */
const notesQueryKey = (pubkey: string | undefined) =>
  ['nostr', 'encrypted-notes', pubkey] as const;

/** Resolved notes plus the state of the most recent relay sync. */
export interface NotesResult {
  notes: EncryptedNote[];
  /** True when the last relay fetch failed and we are showing cached notes. */
  offline: boolean;
  /** Unix ms timestamp of the last successful relay sync, if any. */
  lastSyncedAt?: number;
}

/** Fetch, decrypt, create, update, and delete NIP-44 encrypted private notes (kind 30078). */
export function useEncryptedNotes(): {
  notesQuery: UseQueryResult<NotesResult>;
  saveNote: UseMutationResult<NostrEvent, Error, SaveNoteParams>;
  deleteNote: UseMutationResult<NostrEvent, Error, string>;
} {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: notesQueryKey(user?.pubkey),
    queryFn: async ({ signal }): Promise<NotesResult> => {
      if (!user) return { notes: [], offline: false };
      if (!user.signer.nip44) {
        throw new Error(
          'Your signer does not support NIP-44 encryption. Please upgrade your signer extension.',
        );
      }

      requestPersistentStorage();

      // Offline-first: load whatever is cached locally before touching relays.
      const cachedEvents = await getStoredEvents(user.pubkey);

      // Best-effort relay fetch with a safety timeout, so a hung socket can
      // never block the cached notes from appearing. A failure (offline,
      // relays down, timeout) must not throw: the cache still has the notes.
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', abortFromCaller, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), RELAY_FETCH_TIMEOUT_MS);

      let remoteEvents: NostrEvent[] = [];
      let offline = false;
      try {
        remoteEvents = await nostr.query(
          [{ kinds: [NOTE_KIND], authors: [user.pubkey], limit: 200 }],
          { signal: controller.signal },
        );
      } catch (error) {
        // A caller-initiated cancellation should propagate so TanStack Query
        // discards the result; anything else counts as "offline".
        if (signal.aborted) throw error;
        offline = true;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abortFromCaller);
      }

      // Merge remote and cached copies, keep the newest per note, and persist
      // so the local cache becomes the union of every version seen.
      const merged = mergeEvents(cachedEvents, remoteEvents);
      await storeEvents(user.pubkey, merged);

      const notes: EncryptedNote[] = [];

      for (const event of merged) {
        // Skip events with empty content (deleted)
        if (!event.content) continue;

        try {
          const plaintext = await user.signer.nip44.decrypt(user.pubkey, event.content);
          const data: NoteData = JSON.parse(plaintext);
          const tags = event.tags
            .filter(([name]) => name === 't')
            .map(([, value]) => value);
          notes.push({ event, data, tags });
        } catch {
          // Skip events that fail decryption or JSON parsing
          console.warn('Failed to decrypt note:', event.id);
        }
      }

      // Sort newest first
      notes.sort((a, b) => b.data.updated_at - a.data.updated_at);

      return { notes, offline, lastSyncedAt: offline ? undefined : Date.now() };
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const saveNote = useMutation({
    mutationFn: async (params: SaveNoteParams): Promise<NostrEvent> => {
      if (!user) throw new Error('You must be logged in to save notes.');
      if (!user.signer.nip44) {
        throw new Error(
          'Your signer does not support NIP-44 encryption. Please upgrade your signer extension.',
        );
      }

      const noteData: NoteData = {
        title: params.title,
        content: params.content,
        updated_at: Math.floor(Date.now() / 1000),
      };
      if (params.follow_up_date) {
        noteData.follow_up_date = params.follow_up_date;
      }

      const ciphertext = await user.signer.nip44.encrypt(
        user.pubkey,
        JSON.stringify(noteData),
      );

      const tags: string[][] = [
        ['d', params.id],
        ['alt', ALT_DESCRIPTION],
        ...params.tags.map((t) => ['t', t] as [string, string]),
      ];

      // Add client tag
      if (
        typeof location !== 'undefined' &&
        location.protocol === 'https:'
      ) {
        tags.push(['client', location.hostname]);
      }

      const event = await user.signer.signEvent({
        kind: NOTE_KIND,
        content: ciphertext,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      return event;
    },
    onSuccess: (event) => {
      // Persist locally right away so the note survives even if the write
      // hasn't propagated to our read relays yet.
      if (user) void storeEvents(user.pubkey, [event]);
      queryClient.invalidateQueries({ queryKey: notesQueryKey(user?.pubkey) });
    },
    onError: (error) => {
      console.error('Failed to save note:', error);
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string): Promise<NostrEvent> => {
      if (!user) throw new Error('You must be logged in to delete notes.');

      // For addressable events, "delete" by publishing with empty content
      const event = await user.signer.signEvent({
        kind: NOTE_KIND,
        content: '',
        tags: [
          ['d', noteId],
          ['alt', ALT_DESCRIPTION],
        ],
        created_at: Math.floor(Date.now() / 1000),
      });

      await nostr.event(event, { signal: AbortSignal.timeout(5000) });
      return event;
    },
    onSuccess: (event) => {
      // Persist the tombstone locally so the deletion sticks.
      if (user) void storeEvents(user.pubkey, [event]);
      queryClient.invalidateQueries({ queryKey: notesQueryKey(user?.pubkey) });
    },
    onError: (error) => {
      console.error('Failed to delete note:', error);
    },
  });

  return { notesQuery, saveNote, deleteNote };
}
