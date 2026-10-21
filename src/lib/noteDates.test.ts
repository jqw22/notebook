import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  dateInputValueToUnixSeconds,
  formatNoteDate,
  toDateFromUnixSeconds,
  toDateInputValue,
} from './noteDates';

describe('toDateFromUnixSeconds', () => {
  it('rejects missing, non-finite and non-positive values', () => {
    expect(toDateFromUnixSeconds(undefined)).toBeUndefined();
    expect(toDateFromUnixSeconds(null)).toBeUndefined();
    expect(toDateFromUnixSeconds(NaN)).toBeUndefined();
    expect(toDateFromUnixSeconds(Infinity)).toBeUndefined();
    expect(toDateFromUnixSeconds(0)).toBeUndefined();
    expect(toDateFromUnixSeconds(-5)).toBeUndefined();
  });

  it('rejects timestamps outside the Date range', () => {
    expect(toDateFromUnixSeconds(1e20)).toBeUndefined();
  });

  it('converts seconds to a Date', () => {
    expect(toDateFromUnixSeconds(1_700_000_000)?.getTime()).toBe(1_700_000_000_000);
  });
});

describe('formatNoteDate', () => {
  it('returns null for invalid input instead of throwing', () => {
    expect(formatNoteDate(undefined)).toBeNull();
    expect(formatNoteDate(1e20)).toBeNull();
  });
});

describe('date input round trip', () => {
  // Run east of UTC, where reading the UTC date used to show the previous
  // day. Node picks up a TZ change at runtime.
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Australia/Sydney';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('returns empty values for empty or invalid input', () => {
    expect(toDateInputValue(undefined)).toBe('');
    expect(dateInputValueToUnixSeconds('')).toBeNull();
    expect(dateInputValueToUnixSeconds('not-a-date')).toBeNull();
  });

  it('shows the same day that was picked', () => {
    const stored = dateInputValueToUnixSeconds('2026-11-05');
    expect(toDateInputValue(stored)).toBe('2026-11-05');
  });

  it('does not drift when saved repeatedly', () => {
    let value = '2026-01-31';
    for (let i = 0; i < 5; i++) {
      value = toDateInputValue(dateInputValueToUnixSeconds(value));
    }
    expect(value).toBe('2026-01-31');
  });
});
