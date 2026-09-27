import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Local, offline cache of encrypted notebook events.
 *
 * Notes are stored exactly as they appear on relays — i.e. NIP-44 ciphertext,
 * never plaintext. Keeping the signed events means a cached copy can be
 * re-published to relays verbatim after a relay loss, with no re-encryption.
 *
 * The cache is keyed by the addressable coordinate (`kind:pubkey:d`), so only
 * the latest version of each note is retained. Tombstones (events with empty
 * content, used to signal a deletion) are kept too, so deletions survive a
 * backup/restore round-trip.
 *
 * Every operation is best-effort: IndexedDB can be unavailable (private mode,
 * SSR, tests), and a cache failure must never break the app.
 */

const DB_NAME = 'simple-notebook';
const DB_VERSION = 1;
const STORE = 'note-events';
const NOTE_KIND = 30078;

interface StoredEvent {
  /** Addressable coordinate: `${kind}:${pubkey}:${d}`. */
  address: string;
  pubkey: string;
  kind: number;
  /** Raw, still-encrypted event exactly as it exists on relays. */
  event: NostrEvent;
  /** Duplicated from the event for potential indexing/debugging. */
  created_at: number;
}

/** The `d` tag value of an event, if present. */
function dTag(event: NostrEvent): string | undefined {
  return event.tags.find(([name]) => name === 'd')?.[1];
}

/** Addressable coordinate for a note event, or undefined if it has no `d` tag. */
export function eventAddress(event: NostrEvent): string | undefined {
  const d = dTag(event);
  if (d === undefined) return undefined;
  return `${event.kind}:${event.pubkey}:${d}`;
}

function getIndexedDB(): IDBFactory | undefined {
  try {
    return typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  } catch {
    return undefined;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB();
    if (!idb) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = idb.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'address' });
        store.createIndex('by_pubkey', 'pubkey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

/**
 * Merge any number of event sets, keeping only the latest version of each
 * addressable note (by `created_at`). Tombstones are retained.
 */
export function mergeEvents(...sets: NostrEvent[][]): NostrEvent[] {
  const byAddress = new Map<string, NostrEvent>();
  for (const set of sets) {
    for (const event of set) {
      if (event.kind !== NOTE_KIND) continue;
      const address = eventAddress(event);
      if (address === undefined) continue;
      const existing = byAddress.get(address);
      if (!existing || event.created_at > existing.created_at) {
        byAddress.set(address, event);
      }
    }
  }
  return [...byAddress.values()];
}

/** Read every cached encrypted event authored by `pubkey`. Never throws. */
export async function getStoredEvents(pubkey: string): Promise<NostrEvent[]> {
  try {
    const db = await openDb();
    return await new Promise<NostrEvent[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const index = tx.objectStore(STORE).index('by_pubkey');
      const request = index.getAll(pubkey);
      request.onsuccess = () => {
        const rows = request.result as StoredEvent[];
        resolve(rows.map((row) => row.event));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

/**
 * Upsert events authored by `pubkey`. An event is only written if it is at
 * least as new as the stored version of the same note, so a stale copy can
 * never overwrite a newer one. Never throws.
 */
export async function storeEvents(pubkey: string, events: NostrEvent[]): Promise<void> {
  try {
    const relevant = events.filter(
      (event) =>
        event.kind === NOTE_KIND &&
        event.pubkey === pubkey &&
        eventAddress(event) !== undefined,
    );
    if (relevant.length === 0) return;

    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const event of relevant) {
        const address = eventAddress(event);
        if (address === undefined) continue;
        const getRequest = store.get(address);
        getRequest.onsuccess = () => {
          const existing = getRequest.result as StoredEvent | undefined;
          if (!existing || event.created_at >= existing.created_at) {
            const row: StoredEvent = {
              address,
              pubkey: event.pubkey,
              kind: event.kind,
              event,
              created_at: event.created_at,
            };
            store.put(row);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Best-effort cache: ignore failures.
  }
}

let persistenceRequested = false;

/**
 * Ask the browser to keep this origin's storage even under pressure, so the
 * local note cache is less likely to be evicted. No-op where unsupported.
 */
export function requestPersistentStorage(): void {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    void navigator.storage.persist().catch(() => undefined);
  } catch {
    // Ignore: persistence is a best-effort enhancement.
  }
}
