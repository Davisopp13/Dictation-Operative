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
  audioFileName,
  saveTranscript,
  withRecordingLock,
  type SavedRecording,
} from '@/lib/recordings';
import { errorMessage } from '@/lib/client';
import type { Clip } from '@/lib/domain';
/**
 * Temporary export path for audio and cached transcripts that the retired
 * recorder left on this device. It only appears when this account has such
 * recordings in this browser.
 */
export function Recovery({
  onSaved,
  disabled,
}: {
  onSaved: (clip: Clip) => void;
  disabled: boolean;
}) {
  const { account } = useWorkspaceTools();
  const [items, setItems] = useState<SavedRecording[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirmDelete, setConfirmDelete] = useState<SavedRecording | null>(null);
  const reload = useCallback(() => {
    void store
      .listRecordings(account)
      .then((v) => setItems(v as SavedRecording[]))
      .catch(() => setError('Local recording storage is unavailable.'));
  }, [account]);
  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  async function act(r: SavedRecording, action: 'save' | 'download' | 'delete') {
    setBusy(r.id);
    setError('');
    setNotice('');
    try {
      await withRecordingLock(r.id, async () => {
        if (action === 'save') {
          onSaved(await saveTranscript(r));
          setNotice(
            'Transcript saved to Clipboard. The recording is still on this device.',
          );
        } else if (action === 'delete') {
          await store.deleteRecording(account, r.id);
        } else {
          const audio = (await store.readAudio(account, r.id)) as Blob;
          if (!audio.size)
            throw new Error('This recording has no audio to download.');
          const url = URL.createObjectURL(audio);
          const a = document.createElement('a');
          a.href = url;
          a.download = audioFileName(r);
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
    <section className="panel mb-6" aria-label="Recordings left on this device">
      <h2>Recordings left on this device</h2>
      <p className="subtle text-sm">
        Recording and transcription have been retired. These unfinished
        recordings from this account are still stored in this browser. Download
        the audio or save a transcript to keep it. Nothing is removed until you
        choose Remove from this device.
      </p>
      {items.map((r) => (
        <div className="feature-row" key={r.id}>
          <div>
            <strong>
              {r.transcript ? 'Recording with transcript' : 'Audio recording'}
            </strong>
            <p className="subtle text-sm">
              {new Date(r.createdAt).toLocaleString()} ·{' '}
              {(r.bytes / 1000000).toFixed(1)} MB
            </p>
            {r.transcript && (
              <p className="preserve-text text-sm">
                {r.transcript.length > 280
                  ? r.transcript.slice(0, 280) + '…'
                  : r.transcript}
              </p>
            )}
            <div className="actions">
              {r.transcript && (
                <Button
                  disabled={disabled || !!busy}
                  onClick={() => void act(r, 'save')}
                >
                  {busy === r.id ? 'Working…' : 'Save transcript as text'}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={disabled || !!busy || !r.bytes}
                onClick={() => void act(r, 'download')}
              >
                Download audio
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || !!busy}
                onClick={() => setConfirmDelete(r)}
              >
                Remove from this device
              </Button>
            </div>
          </div>
        </div>
      ))}
      {notice && <output className="block text-sm">{notice}</output>}
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
            <AlertDialogTitle>Remove this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the audio and any cached transcript from
              this device. Text already saved to Clipboard is kept.
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
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
