import { Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNoteDate, toDateFromUnixSeconds } from '@/lib/noteDates';
import type { EncryptedNote } from '@/hooks/useEncryptedNotes';

export interface NoteCardProps {
  note: EncryptedNote;
  onClick: () => void;
  className?: string;
}

export function NoteCard({ note, onClick, className }: NoteCardProps) {
  const { data, tags } = note;

  const updatedDate = toDateFromUnixSeconds(data.updated_at);
  const formattedDate = formatNoteDate(data.updated_at) ?? 'Unknown date';
  const followUpDate = formatNoteDate(data.follow_up_date);
  const hasFollowUp = followUpDate !== null;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:shadow-md hover:border-primary/30 motion-safe:transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        hasFollowUp && 'bg-pink-50 border-pink-200',
        className,
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-semibold leading-tight line-clamp-2">
            {data.title || 'Untitled Note'}
          </h3>
          {hasFollowUp && (
            <span className="shrink-0 flex items-center gap-1 text-xs text-pink-700 bg-pink-100 rounded-md px-2 py-1 font-medium">
              <Calendar className="h-3 w-3" />
              {followUpDate}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.content && (
          <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
            {data.content}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {tags.length > 0 ? (
              tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground italic">
                No tags
              </span>
            )}
          </div>
          <time
            dateTime={updatedDate?.toISOString()}
            className="text-xs text-muted-foreground shrink-0"
          >
            {formattedDate}
          </time>
        </div>
      </CardContent>
    </Card>
  );
}
