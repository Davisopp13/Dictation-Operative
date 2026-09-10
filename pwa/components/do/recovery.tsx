'use client';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useWorkspaceTools } from './workspace-tools';
import {
  store,
  recoverRecording,
  withRecordingLock,
  type SavedRecording,
} from '@/lib/recordings';
import { errorMessage } from '@/lib/client';
import type { Clip } from '@/lib/domain';
export function Recovery({
  onRecovered,
  ensureCloud,
  disabled,
}: {
  onRecovered: (clip: Clip) => void;
  ensureCloud: () => boolean;
  disabled: boolean;
}) {
  const { account } = useWorkspaceTools();
  const [items, setItems] = useState<SavedRecording[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [confirmDelete, setConfirmDelete] = useState<SavedRecording | null>(null);
  const reload = useCallback(() => {
    void store
      .listRecordings(account)
      .then((v) => setItems(v as SavedRecording[]))
      .catch(() => setError('Local recovery storage is unavailable.'));
  }, [account]);
  useEffect(() => {
    void store.setAccount(account).catch(() => {});
    reload();
    const handler = () => reload();
    window.addEventListener('do-recordings', handler);
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('do-recordings', handler);
      window.removeEventListener('focus', handler);
    };
  }, [account, reload]);
  async function act(
    r: SavedRecording,
    action: 'recover' | 'download' | 'delete',
  ) {
    if (action === 'recover' && !ensureCloud()) return;
    setBusy(r.id);
    setError('');
    try {
      await withRecordingLock(r.id, async () => {
        if (action === 'recover') {
          onRecovered(await recoverRecording(r));
        } else if (action === 'delete') {
          await store.deleteRecording(account, r.id);
        } else {
          const audio = (await store.readAudio(account, r.id)) as Blob;
          const url = URL.createObjectURL(audio);
          const a = document.createElement('a');
          a.href = url;
          a.download =
            'do-recording-' +
            r.id +
            (r.mime.includes('mp4') ? '.m4a' : '.webm');
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
      });
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  }
  if (!items.length && !error) return null;
  return (
    <section className="panel mb-6" aria-label="Recording recovery">
      <h2>Unfinished recordings on this device</h2>
      <p className="subtle text-sm">
        Audio is removed after saving to your library. Recovery saves original
        words; apply a template afterward. Keep this device’s browser data until
        recovery is complete.
      </p>
      {items.map((r) => (
        <div className="feature-row" key={r.id}>
          <div>
            <strong>
              {r.target.clipId
                ? 'Add to existing thought'
                : r.target.kind === 'reply'
                  ? 'Reply points'
                  : r.target.kind === 'prompt'
                    ? 'Prompt idea'
                    : 'New thought'}
            </strong>
            <p className="subtle text-sm">
              {new Date(r.createdAt).toLocaleString()} ·{' '}
              {(r.bytes / 1000000).toFixed(1)} MB{' '}
              {r.state === 'recording'
                ? '· Interrupted or active in another tab'
                : ''}
            </p>
            <div className="actions">
              <Button
                disabled={disabled || !!busy}
                onClick={() => void act(r, 'recover')}
              >
                {busy === r.id ? 'Working…' : 'Recover to library'}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !!busy}
                onClick={() => void act(r, 'download')}
              >
                Download audio
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || !!busy}
                onClick={() => setConfirmDelete(r)}
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      ))}
      {error && (
        <Alert variant="destructive" className="error-message" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the unfinished recording from this
              device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white"
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) void act(target, 'delete');
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
