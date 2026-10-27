import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter, NPool } from '@nostrify/nostrify';

import { findUnsynced, getStoredEvents, mergeEvents, requestPersistentStorage, storeEvents } from '@/lib/noteStore';
import { useCurrentUser } from './useCurrentUser';

/** The decrypted payload stored in the event content. */
export interface NoteData {
  title: string;
  content: string;
  updated_at: number;
  /** Optional follow-up date as a Unix timestamp (seconds). */
  follow_up_date?: number;
}

/** Result of a save or delete. */
export interface WriteResult {
  event: NostrEvent;
  /**
   * False when no relay accepted the event. It is kept on this device and
   * re-published on the next successful sync.
   */
  published: boolean;
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
const ALT_DESCRIPTION = 'Encrypted My Notes entry';

/**
 * Validate and normalise a decrypted note payload.
 *
 * The payload is user-controlled event content and is therefore never trusted.
 * Kind 30078 is the generic NIP-78 "app data" kind shared by many clients, so
 * a query filtered by author alone can also return *other* apps' app-data
 * events. Those payloads — and any legacy or corrupt note — must be recognised
 * here and either coerced into a valid note or rejected, rather than reaching
 * the UI where a missing `updated_at` would throw "Invalid time value".
 *
 * `eventCreatedAt` is used as a fallback for a missing/invalid `updated_at` so
 * a note can always be rendered and sorted.
 */
export function parseNoteData(raw: unknown, eventCreatedAt: number): NoteData | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;

  const hasTitle = typeof record.title === 'string';
  const hasContent = typeof record.content === 'string';
  // A notebook note always carries at least one of these; a payload with
  // neither is another app's app-data and is ignored.
  if (!hasTitle && !hasContent) {
    return undefined;
  }

  const updatedAt =
    typeof record.updated_at === 'number' && Number.isFinite(record.updated_at)
      ? record.updated_at
      : eventCreatedAt;

  const followUp = record.follow_up_date;
  const followUpDate =
    typeof followUp === 'number' && Number.isFinite(followUp) && followUp > 0
      ? followUp
      : undefined;

  return {
    title: hasTitle ? (record.title as string) : '',
    content: hasContent ? (record.content as string) : '',
    updated_at: updatedAt,
    ...(followUpDate !== undefined ? { follow_up_date: followUpDate } : {}),
  };
}

/**
 * Safety timeout for each page of the relay read. If a relay socket hangs
 * without ever responding, we abandon the fetch and fall back to the local
 * cache rather than leaving the notebook stuck on its loading state. It is
 * per page so a large notebook isn't cut off just for taking several pages.
 */
const RELAY_FETCH_TIMEOUT_MS = 8000;

/** Events requested per relay page. */
const PAGE_SIZE = 200;

/**
 * Upper bound on pages, so a relay that ignores `until` can't loop forever.
 * 50 pages is 10,000 events.
 */
const MAX_PAGES = 50;

/** Timeout for publishing a single event. */
const PUBLISH_TIMEOUT_MS = 5000;

/**
 * Fetch every kind 30078 event by `pubkey`, paging backwards with `until`.
 *
 * A single `limit` query would silently drop older notes once the user has
 * more than a page of events (other apps' app data and tombstones count
 * toward the limit too).
 */
export async function fetchAllNoteEvents(
  nostr: NPool,
  pubkey: string,
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const byId = new Map<string, NostrEvent>();
  let until: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const filter: NostrFilter = { kinds: [NOTE_KIND], authors: [pubkey], limit: PAGE_SIZE };
    if (until !== undefined) filter.until = until;

    const events = await queryWithTimeout(nostr, filter, signal);

    let added = 0;
    let oldest = Infinity;
    for (const event of events) {
      if (!byId.has(event.id)) {
        byId.set(event.id, event);
        added++;
      }
      oldest = Math.min(oldest, event.created_at);
    }

    // A short page means the relays have nothing older. `until` is
    // inclusive, so a page of only already-seen events means the same.
    if (events.length < PAGE_SIZE || added === 0) break;
    until = oldest;
  }

  return [...byId.values()];
}

/** Run one relay query, aborted by `signal` or after RELAY_FETCH_TIMEOUT_MS. */
async function queryWithTimeout(
  nostr: NPool,
  filter: NostrFilter,
  signal: AbortSignal,
): Promise<NostrEvent[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }
  const timer = setTimeout(abort, RELAY_FETCH_TIMEOUT_MS);
  try {
    return await nostr.query([filter], { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** Publish an event, reporting whether any relay accepted it. Never throws. */
async function tryPublish(nostr: NPool, event: NostrEvent): Promise<boolean> {
  try {
    await nostr.event(event, { signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
    return true;
  } catch (error) {
    console.warn('Publish failed; kept locally for the next sync:', error);
    return false;
  }
}

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
  saveNote: UseMutationResult<WriteResult, Error, SaveNoteParams>;
  deleteNote: UseMutationResult<WriteResult, Error, string>;
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

      // Best-effort relay fetch with a per-page safety timeout, so a hung
      // socket can never block the cached notes from appearing. A failure
      // (offline, relays down, timeout) must not throw: the cache still has
      // the notes.
      let remoteEvents: NostrEvent[] = [];
      let offline = false;
      try {
        remoteEvents = await fetchAllNoteEvents(nostr, user.pubkey, signal);
      } catch (error) {
        // A caller-initiated cancellation should propagate so TanStack Query
        // discards the result; anything else counts as "offline".
        if (signal.aborted) throw error;
        offline = true;
      }

      // Merge remote and cached copies, keep the newest per note, and persist
      // so the local cache becomes the union of every version seen.
      const merged = mergeEvents(cachedEvents, remoteEvents);
      await storeEvents(user.pubkey, merged);

      // Relays are reachable: push anything they are missing, i.e. saves made
      // offline and deletions a relay never received. Fire and forget, so a
      // slow relay can't hold up the notes.
      if (!offline) {
        for (const event of findUnsynced(cachedEvents, remoteEvents)) {
          void tryPublish(nostr, event);
        }
      }

      const notes: EncryptedNote[] = [];

      for (const event of merged) {
        // Skip events with empty content (deleted)
        if (!event.content) continue;

        try {
          const plaintext = await user.signer.nip44.decrypt(user.pubkey, event.content);
          const data = parseNoteData(JSON.parse(plaintext), event.created_at);
          if (!data) continue;
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
    mutationFn: async (params: SaveNoteParams): Promise<WriteResult> => {
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

      // Keep it locally before publishing, so the note survives even when no
      // relay is reachable; the next sync re-publishes it.
      await storeEvents(user.pubkey, [event]);
      const published = await tryPublish(nostr, event);
      return { event, published };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(user?.pubkey) });
    },
    onError: (error) => {
      console.error('Failed to save note:', error);
    },
  });

  const deleteNote = useMutation({
    mutationFn: async (noteId: string): Promise<WriteResult> => {
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

      // Keep the tombstone locally so the deletion sticks offline; the next
      // sync re-publishes it to any relay that missed it.
      await storeEvents(user.pubkey, [event]);
      const published = await tryPublish(nostr, event);
      return { event, published };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notesQueryKey(user?.pubkey) });
    },
    onError: (error) => {
      console.error('Failed to delete note:', error);
    },
  });

  return { notesQuery, saveNote, deleteNote };
}
