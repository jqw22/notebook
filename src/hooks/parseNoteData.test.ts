import { describe, expect, it } from 'vitest';

import { parseNoteData } from './useEncryptedNotes';

const CREATED_AT = 1_700_000_000;

describe('parseNoteData', () => {
  it('accepts a full note payload', () => {
    expect(
      parseNoteData(
        { title: 'T', content: 'C', updated_at: 1_700_000_500, follow_up_date: 1_700_100_000 },
        CREATED_AT,
      ),
    ).toEqual({ title: 'T', content: 'C', updated_at: 1_700_000_500, follow_up_date: 1_700_100_000 });
  });

  it("ignores payloads that aren't notes", () => {
    expect(parseNoteData(null, CREATED_AT)).toBeUndefined();
    expect(parseNoteData('text', CREATED_AT)).toBeUndefined();
    expect(parseNoteData([1, 2], CREATED_AT)).toBeUndefined();
    expect(parseNoteData({ settings: { theme: 'dark' } }, CREATED_AT)).toBeUndefined();
  });

  it('fills in a missing title or content', () => {
    expect(parseNoteData({ content: 'only body' }, CREATED_AT)?.title).toBe('');
    expect(parseNoteData({ title: 'only title' }, CREATED_AT)?.content).toBe('');
  });

  it('falls back to the event time for a bad updated_at', () => {
    expect(parseNoteData({ title: 'T', updated_at: 'yesterday' }, CREATED_AT)?.updated_at).toBe(CREATED_AT);
    expect(parseNoteData({ title: 'T', updated_at: NaN }, CREATED_AT)?.updated_at).toBe(CREATED_AT);
  });

  it('drops an invalid follow-up date', () => {
    for (const follow_up_date of [0, -1, 'soon', null, Infinity]) {
      expect(parseNoteData({ title: 'T', follow_up_date }, CREATED_AT)).not.toHaveProperty('follow_up_date');
    }
  });
});
