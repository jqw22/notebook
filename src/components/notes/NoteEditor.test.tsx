import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';

import { NoteEditor } from './NoteEditor';
import type { EncryptedNote } from '@/hooks/useEncryptedNotes';

const note: EncryptedNote = {
  event: {
    id: 'id',
    pubkey: 'pk',
    kind: 30078,
    created_at: 1000,
    content: 'ciphertext',
    tags: [['d', 'note-1']],
    sig: 'sig',
  } satisfies NostrEvent,
  data: { title: 'Groceries', content: 'Milk', updated_at: 1000 },
  tags: [],
};

function renderEditor(props: Partial<React.ComponentProps<typeof NoteEditor>> = {}) {
  const handlers = { onClose: vi.fn(), onSave: vi.fn(), onDelete: vi.fn() };
  render(<NoteEditor note={note} isOpen {...handlers} {...props} />);
  return handlers;
}

describe('NoteEditor', () => {
  it('asks before deleting', () => {
    const { onDelete } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this note?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('note-1');
  });

  it('closes straight away when nothing changed', () => {
    const { onClose } = renderEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before discarding unsaved changes', () => {
    const { onClose } = renderEditor();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Groceries!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });
});
