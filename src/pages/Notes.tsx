import { useState, useMemo, useCallback } from 'react';
import { useSeoMeta } from '@unhead/react';
import { Plus, NotebookPen, Shield, Key, AlertTriangle, Search, ArrowUpDown, X } from 'lucide-react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEncryptedNotes, type EncryptedNote, type SaveNoteParams } from '@/hooks/useEncryptedNotes';
import { NoteCard } from '@/components/notes/NoteCard';
import { NoteEditor } from '@/components/notes/NoteEditor';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type SortMode = 'newest' | 'oldest' | 'title-asc' | 'title-desc';

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  'title-asc': 'Title A\u2013Z',
  'title-desc': 'Title Z\u2013A',
};

const UNTAGGED_KEY = '__untagged__';

export default function NotesPage() {
  useSeoMeta({
    title: 'Notebook',
    description: 'Your encrypted notebook powered by Nostr NIP-44 encryption.',
  });

  const { user } = useCurrentUser();
  const { notesQuery, saveNote, deleteNote } = useEncryptedNotes();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<EncryptedNote | undefined>(undefined);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  const notes = notesQuery.data ?? [];
  const isLoading = notesQuery.isLoading;
  const isError = notesQuery.isError;
  const error = notesQuery.error;

  // Collect all unique tags across all notes, plus count untagged
  const { allTags, untaggedCount } = useMemo(() => {
    const tagSet = new Set<string>();
    let untagged = 0;
    for (const note of notes) {
      if (note.tags.length === 0) {
        untagged++;
      }
      for (const tag of note.tags) {
        tagSet.add(tag);
      }
    }
    return { allTags: Array.from(tagSet).sort(), untaggedCount: untagged };
  }, [notes]);

  // Filter and sort notes
  const filteredNotes = useMemo(() => {
    let result = notes;

    // Filter by multi-select tags (OR logic)
    if (selectedTags.size > 0) {
      const wantsUntagged = selectedTags.has(UNTAGGED_KEY);
      const realTags = new Set(
        Array.from(selectedTags).filter((t) => t !== UNTAGGED_KEY),
      );

      result = result.filter((note) => {
        if (wantsUntagged && note.tags.length === 0) return true;
        if (realTags.size > 0 && note.tags.some((tag) => realTags.has(tag))) return true;
        return false;
      });
    }

    // Client-side search by title and content
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter(
        (note) =>
          note.data.title.toLowerCase().includes(query) ||
          note.data.content.toLowerCase().includes(query),
      );
    }

    // Sort
    switch (sortMode) {
      case 'newest':
        result = [...result].sort((a, b) => b.data.updated_at - a.data.updated_at);
        break;
      case 'oldest':
        result = [...result].sort((a, b) => a.data.updated_at - b.data.updated_at);
        break;
      case 'title-asc':
        result = [...result].sort((a, b) =>
          (a.data.title || 'Untitled').localeCompare(b.data.title || 'Untitled'),
        );
        break;
      case 'title-desc':
        result = [...result].sort((a, b) =>
          (b.data.title || 'Untitled').localeCompare(a.data.title || 'Untitled'),
        );
        break;
    }

    return result;
  }, [notes, selectedTags, searchQuery, sortMode]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const clearTags = useCallback(() => {
    setSelectedTags(new Set());
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const openNewNote = useCallback(() => {
    setEditingNote(undefined);
    setEditorOpen(true);
  }, []);

  const openEditNote = useCallback((note: EncryptedNote) => {
    setEditingNote(note);
    setEditorOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setEditingNote(undefined);
  }, []);

  const handleSave = useCallback(
    (params: SaveNoteParams) => {
      saveNote.mutate(params, {
        onSuccess: () => closeEditor(),
      });
    },
    [saveNote, closeEditor],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteNote.mutate(id, {
        onSuccess: () => closeEditor(),
      });
    },
    [deleteNote, closeEditor],
  );

  const hasActiveFilters = selectedTags.size > 0 || searchQuery.trim() !== '';

  // --- Not logged in ---
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Notebook</h1>
            <p className="text-muted-foreground">
              Your notes are encrypted with NIP-44 and stored on Nostr relays.
              Log in to access your notebook.
            </p>
          </div>
          <LoginArea className="w-full max-w-60 mx-auto" />
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Key className="h-3 w-3" /> End-to-end encrypted
            </span>
            <span className="flex items-center gap-1">
              <NotebookPen className="h-3 w-3" /> Editable notes
            </span>
          </div>
        </div>
      </div>
    );
  }

  // --- Check for NIP-44 support ---
  if (!user.signer.nip44) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Signer Not Supported</h1>
            <p className="text-muted-foreground">
              Your current signer does not support NIP-44 encryption, which is
              required for private notes. Please upgrade your signer extension
              or use a different login method.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-10 w-32" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6 space-y-3">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-12 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Failed to Load Notes</h1>
            <p className="text-muted-foreground">
              {error instanceof Error ? error.message : 'An unexpected error occurred while loading your notes.'}
            </p>
          </div>
          <Button variant="outline" onClick={() => notesQuery.refetch()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // --- Main view ---
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notebook</h1>
            <p className="text-muted-foreground mt-1">
              {notes.length} note{notes.length !== 1 ? 's' : ''} &middot; end-to-end encrypted
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LoginArea className="max-w-40" />
            <Button onClick={openNewNote} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New Note
            </Button>
          </div>
        </div>

        {/* Toolbar: search + sort */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="pl-9 pr-8"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="w-full sm:w-[180px] gap-1.5">
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(SORT_LABELS) as [SortMode, string][]
              ).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tag filter bar */}
        {(allTags.length > 0 || untaggedCount > 0) && (
          <ScrollArea className="pb-1">
            <div className="flex gap-1.5 flex-nowrap items-center">
              {selectedTags.size > 0 && (
                <Badge
                  variant="secondary"
                  className="cursor-pointer shrink-0 gap-1"
                  onClick={clearTags}
                >
                  Clear
                  <X className="h-3 w-3" />
                </Badge>
              )}
              {untaggedCount > 0 && (
                <Badge
                  variant={selectedTags.has(UNTAGGED_KEY) ? 'default' : 'outline'}
                  className="cursor-pointer shrink-0"
                  onClick={() => toggleTag(UNTAGGED_KEY)}
                >
                  Untagged ({untaggedCount})
                </Badge>
              )}
              {allTags.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.has(tag) ? 'default' : 'outline'}
                  className="cursor-pointer shrink-0"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Notes grid */}
        {filteredNotes.length > 0 ? (
          <>
            {hasActiveFilters && (
              <p className="text-sm text-muted-foreground">
                Showing {filteredNotes.length} of {notes.length} note{notes.length !== 1 ? 's' : ''}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredNotes.map((note) => (
                <NoteCard
                  key={note.event.tags.find(([n]) => n === 'd')?.[1] ?? note.event.id}
                  note={note}
                  onClick={() => openEditNote(note)}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            hasNotes={notes.length > 0}
            hasFilter={hasActiveFilters}
            onCreateNew={openNewNote}
          />
        )}

        {/* Note Editor Dialog */}
        <NoteEditor
          note={editingNote}
          isOpen={editorOpen}
          onClose={closeEditor}
          onSave={handleSave}
          onDelete={handleDelete}
          isSaving={saveNote.isPending}
          isDeleting={deleteNote.isPending}
        />
      </div>
    </div>
  );
}

function EmptyState({
  hasNotes,
  hasFilter,
  onCreateNew,
}: {
  hasNotes: boolean;
  hasFilter: boolean;
  onCreateNew: () => void;
}) {
  if (hasFilter) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 px-8 text-center">
          <p className="text-muted-foreground max-w-sm mx-auto">
            No notes match your search or tag filters. Try adjusting your filters.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed">
      <CardContent className="py-16 px-8 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <NotebookPen className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-xl font-semibold">No notes yet</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Create your first encrypted note. It will be stored privately on
            Nostr relays using NIP-44 encryption.
          </p>
        </div>
        <Button onClick={onCreateNew} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create Your First Note
        </Button>
      </CardContent>
    </Card>
  );
}
