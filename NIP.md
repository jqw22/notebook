# NIP.md — Custom Nostr Schemas

## Notebook — Encrypted Notebook (Kind 30078)

Uses the existing NIP-78 (kind 30078, "Arbitrary Custom App Data") addressable event kind for private, encrypted notebook entries.

### Event Structure

| Field     | Value                                                                     |
| --------- | ------------------------------------------------------------------------- |
| kind      | `30078` (NIP-78 addressable)                                              |
| content   | NIP-44 encrypted JSON (encrypted to self)                                 |
| `d` tag   | UUID v4 — unique note identifier                                          |
| `t` tags  | User-defined organizational tags (cleartext, one per tag)                 |
| `alt` tag | `"Encrypted Notebook entry"` (NIP-31)                             |

### Decrypted Content Schema (JSON)

```json
{
  "title": "My Note",
  "content": "The note body text...",
  "updated_at": 1690000000,
  "follow_up_date": 1692000000
}
```

- `title` (string) — Note title. May be empty.
- `content` (string) — Note body. May be empty.
- `updated_at` (number) — Unix timestamp (seconds) of last save.
- `follow_up_date` (number, optional) — Unix timestamp (seconds) for an optional follow-up reminder date.

### Robustness

Because kind 30078 is a generic NIP-78 "app data" kind, an author-only query can also return *other* apps' app-data events. Decrypted payloads are therefore validated before use: a payload must be a JSON object carrying at least a string `title` or `content` (otherwise it is ignored), a missing/invalid `updated_at` falls back to the event's `created_at`, and an invalid `follow_up_date` is dropped. Timestamps are only ever formatted through guarded helpers, so malformed data can never crash the app.

### Encryption

Content is encrypted with NIP-44 to the author's own pubkey (encrypt-to-self). Only the author can decrypt their notes.

### Deletion

Notes are "deleted" by publishing a new kind 30078 event with the same `d` tag and **empty content**. Clients filter out entries with empty content.

### Query

```
{ kinds: [30078], authors: [<user_pubkey>], limit: 200 }
```

Tags (`t`) are stored in cleartext to enable relay-side filtering by tag, at the cost of leaking tag metadata to relays. Content remains fully encrypted.
