/**
 * Safe date helpers for notebook timestamps.
 *
 * Note timestamps are stored as Unix seconds, but they are read back from
 * decrypted event content that is ultimately user-controlled (and kind 30078
 * is a generic kind shared with other apps). A malformed value must never
 * throw: calling `toISOString()` on an Invalid Date raises a `RangeError`
 * ("Invalid time value") that would crash the whole app through the error
 * boundary. Every conversion therefore goes through these guards.
 */

/** Convert a Unix-seconds timestamp to a valid Date, or undefined when unusable. */
export function toDateFromUnixSeconds(
  value: number | null | undefined,
): Date | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Format a Unix-seconds timestamp as a short date, or null when invalid. */
export function formatNoteDate(value: number | null | undefined): string | null {
  const date = toDateFromUnixSeconds(value);
  return date
    ? date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;
}

/** `YYYY-MM-DD` value for an `<input type="date">`, or '' when invalid. */
export function toDateInputValue(value: number | null | undefined): string {
  const date = toDateFromUnixSeconds(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

/** Parse a `YYYY-MM-DD` input value into Unix seconds, or null when invalid/empty. */
export function dateInputValueToUnixSeconds(value: string): number | null {
  if (!value) return null;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}
