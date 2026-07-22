import { useNostr } from '@nostrify/react';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { useCurrentUser } from './useCurrentUser';

/** The decrypted payload stored in the event content. */
export interface NoteData {
  title: string;
  content: string;
  updated_at: number;
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
}

const NOTE_KIND = 30078;
const ALT_DESCRIPTION = 'Encrypted private notebook entry';

/** Fetch, decrypt, create, update, and delete NIP-44 encrypted private notes (kind 30078). */
export function useEncryptedNotes(): {
  notesQuery: UseQueryResult<EncryptedNote[]>;
  saveNote: UseMutationResult<NostrEvent, Error, SaveNoteParams>;
  deleteNote: UseMutationResult<NostrEvent, Error, string>;
} {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: ['encrypted-notes', user?.pubkey],
    queryFn: async ({ signal }): Promise<EncryptedNote[]> => {
      if (!user) return [];
      if (!user.signer.nip44) {
        throw new Error(
          'Your signer does not support NIP-44 encryption. Please upgrade your signer extension.',
        );
      }

      const events = await nostr.query(
        [{ kinds: [NOTE_KIND], authors: [user.pubkey], limit: 200 }],
        { signal },
      );

      const notes: EncryptedNote[] = [];

      for (const event of events) {
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
      return notes.sort((a, b) => b.data.updated_at - a.data.updated_at);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['encrypted-notes', user?.pubkey] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['encrypted-notes', user?.pubkey] });
    },
    onError: (error) => {
      console.error('Failed to delete note:', error);
    },
  });

  return { notesQuery, saveNote, deleteNote };
}
