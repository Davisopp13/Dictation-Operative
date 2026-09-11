'use client';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { api, errorMessage } from '@/lib/client';
import type { ClipSummary } from '@/lib/domain';

export function DeleteClipboardText({
  clip,
  locked,
  onDelete,
}: {
  clip: ClipSummary;
  locked: boolean;
  onDelete: (id: string) => void;
}) {
  const [target, setTarget] = useState<ClipSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deleting = useRef(false);

  async function remove() {
    if (!target || locked || deleting.current) return;
    deleting.current = true;
    setBusy(true);
    setError('');
    try {
      await api('clips/' + target.id, {
        method: 'DELETE',
        body: JSON.stringify({ revision: target.revision }),
      });
      setTarget(null);
      onDelete(target.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      deleting.current = false;
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (deleting.current) return;
        setError('');
        setTarget(open ? clip : null);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="icon-control"
            disabled={locked}
            aria-label={`Delete ${clip.title}`}
            title="Delete text"
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this text?</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete “{target?.title}” and all its versions from your
            shared Clipboard, including All and Pinned. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep text</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={locked || busy}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
