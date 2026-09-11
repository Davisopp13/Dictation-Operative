'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Mic, Square, RotateCcw, Download } from 'lucide-react';
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
import {
  store,
  withRecordingLock,
  type RecordingTarget,
} from '@/lib/recordings';
import { useWorkspaceTools } from './workspace-tools';
import { api, errorMessage } from '@/lib/client';
import {
  LocalSpeechPreview,
  type RecognitionCtor,
} from '@/lib/local-speech-preview';
const BARS = 40;
const emptyLevels = () => Array.from({ length: BARS }, () => 0);

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

type Props = {
  onTranscript: (text: string, recordingId: string) => Promise<void>;
  ensureCloud: () => boolean;
  onBusy?: (busy: boolean) => void;
  compact?: boolean;
  target?: RecordingTarget;
};
export function Recorder({
  onTranscript,
  ensureCloud,
  onBusy,
  compact = false,
  target = {},
}: Props) {
  const { account } = useWorkspaceTools();
  const writes = useRef<Promise<unknown>>(Promise.resolve()),
    unlock = useRef<(() => void) | null>(null),
    storageError = useRef('');
  const [state, setState] = useState<
    'idle' | 'starting' | 'recording' | 'processing' | 'retry'
  >('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(''),
    [durable, setDurable] = useState(true),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    blob = useRef<Blob | null>(null),
    transcript = useRef<string | null>(null),
    recordingId = useRef(''),
    mounted = useRef(true),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    processing = useRef(false),
    active = useRef(false);
  const currentCallback = useRef(onTranscript);
  useEffect(() => {
    currentCallback.current = onTranscript;
  }, [onTranscript]);
  // The level meter is the only honest answer to "is it hearing me?".
  const [levels, setLevels] = useState<number[]>(() => emptyLevels());
  const audio = useRef<AudioContext | null>(null),
    analyser = useRef<AnalyserNode | null>(null),
    frame = useRef<number | null>(null);
  // A live preview of your words, the way the Mac app shows one: the settled
  // prefix reads solid, the still-changing tail reads dim. It is a preview
  // only — the saved transcript still comes from the transcription provider.
  const [settled, setSettled] = useState('');
  const [tail, setTail] = useState('');
  const preview = useRef<LocalSpeechPreview | null>(null);
  if (preview.current === null) preview.current = new LocalSpeechPreview();
  const stopPreview = useCallback(() => preview.current?.stop(), []);
  const startPreview = () => {
    const source = recorder.current;
    return preview.current!.start(
      recognitionCtor(),
      navigator.language || 'en-US',
      () =>
        mounted.current &&
        recorder.current === source &&
        source?.state === 'recording',
      (confirmed, interim) => {
        setSettled(confirmed);
        setTail(interim);
      },
    );
  };
  const stopMeter = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    analyser.current = null;
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    setLevels(emptyLevels());
  }, []);
  const startMeter = (source: MediaStream) => {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      const context = new Ctor();
      const node = context.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.75;
      context.createMediaStreamSource(source).connect(node);
      audio.current = context;
      analyser.current = node;
      const buffer = new Uint8Array(node.frequencyBinCount);
      const tick = () => {
        const current = analyser.current;
        if (!current) return;
        current.getByteTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sum += v * v;
        }
        // Speech RMS sits around 0.01-0.2, so lift it into a readable range.
        const rms = Math.sqrt(sum / buffer.length);
        const level = Math.min(1, rms * 6);
        setLevels((prev) => [...prev.slice(1), level]);
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      // No meter is better than no recording; capture continues regardless.
    }
  };
  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    stopMeter();
    stopPreview();
    if (timer.current) clearInterval(timer.current);
    if (timeout.current) clearTimeout(timeout.current);
  };
  const cancelled = useRef(false);
  const stop = useCallback(() => {
    stopPreview();
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, [stopPreview]);
  const cancel = () => {
    cancelled.current = true;
    stop();
  };
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) stop();
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (active.current) {
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', leaving);
    return () => {
      mounted.current = false;
      onBusy?.(false);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      stopMeter();
      stopPreview();
      if (timer.current) clearInterval(timer.current);
      if (timeout.current) clearTimeout(timeout.current);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [onBusy, stop, stopMeter, stopPreview]);
  useEffect(() => {
    const busy = state !== 'idle';
    active.current = busy;
    onBusy?.(busy);
  }, [state, onBusy]);
  async function process() {
    if (processing.current) return;
    processing.current = true;
    setState('processing');
    setError('');
    try {
      if (!unlock.current && navigator.locks) {
        await new Promise<void>((resolve, reject) => {
          void navigator.locks
            .request(
              'do-recording-' + recordingId.current,
              { ifAvailable: true },
              async (lock) => {
                if (!lock) {
                  reject(new Error('Recording is active in another tab.'));
                  return;
                }
                resolve();
                await new Promise<void>((r) => {
                  unlock.current = r;
                });
              },
            )
            .catch(reject);
        });
      }
      await writes.current;
      if (storageError.current) throw new Error(storageError.current);
      if (!navigator.onLine)
        throw new Error(
          'Saved on this device. Reconnect, then retry or recover from Unfinished recordings.',
        );
      if (!transcript.current) {
        if (!blob.current || blob.current.size < 100)
          throw new Error('The recording was empty. Please try again.');
        const form = new FormData();
        const ext = blob.current.type.includes('mp4')
          ? 'm4a'
          : blob.current.type.includes('ogg')
            ? 'ogg'
            : 'webm';
        form.append('audio', blob.current, `thought.${ext}`);
        const r = await api<{ text: string }>('transcribe', {
          method: 'POST',
          body: form,
        });
        transcript.current = r.text;
        await store.updateRecording(account, recordingId.current, {
          transcript: r.text,
        });
      }
      await currentCallback.current(transcript.current, recordingId.current);
      await store.deleteRecording(account, recordingId.current);
      window.dispatchEvent(new Event('do-recordings'));
      if (mounted.current) {
        setState('idle');
        blob.current = null;
        transcript.current = null;
        setSeconds(0);
      }
    } catch (e) {
      if (mounted.current) {
        setError(errorMessage(e));
        setState('retry');
      }
    } finally {
      processing.current = false;
      unlock.current?.();
      unlock.current = null;
    }
  }
  async function start() {
    if (!ensureCloud()) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setError(
        'This browser cannot record audio. Open DO in Safari or Chrome, or use text capture.',
      );
      return;
    }
    setError('');
    setState('starting');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!mounted.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = mic;
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(mic, {
        ...(mime ? { mimeType: mime } : {}),
        audioBitsPerSecond: 64000,
      });
      recorder.current = r;
      const chunks: Blob[] = [];
      let bytes = 0;
      recordingId.current = crypto.randomUUID();
      cancelled.current = false;
      transcript.current = null;
      blob.current = null;
      storageError.current = '';
      setDurable(true);
      if (!navigator.locks)
        throw new Error(
          'Update Safari or Chrome to use protected recording recovery.',
        );
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request('do-recording-' + recordingId.current, async () => {
            resolve();
            await new Promise<void>((r) => {
              unlock.current = r;
            });
          })
          .catch(reject);
      });
      await store.beginRecording(
        account,
        recordingId.current,
        r.mimeType || mime || 'audio/webm',
        target,
      );
      if (!mounted.current) {
        release();
        unlock.current?.();
        unlock.current = null;
        return;
      }
      void navigator.storage?.persist?.().catch(() => {});
      let chunkIndex = 0;
      writes.current = Promise.resolve();
      r.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          const index = chunkIndex++;
          writes.current = writes.current
            .then(() =>
              store.appendChunk(account, recordingId.current, index, e.data),
            )
            .catch(() => {
              setDurable(false);
              storageError.current =
                'Device storage could not save all audio. Download this recording now before leaving.';
              stop();
            });
          bytes += e.data.size;
          if (bytes > 19000000) stop();
        }
      };
      r.onstop = async () => {
        release();
        if (cancelled.current) {
          cancelled.current = false;
          const id = recordingId.current;
          blob.current = null;
          transcript.current = null;
          await writes.current.catch(() => {});
          await store.deleteRecording(account, id).catch(() => {});
          window.dispatchEvent(new Event('do-recordings'));
          unlock.current?.();
          unlock.current = null;
          if (mounted.current) {
            setState('idle');
            setSeconds(0);
            setError('');
          }
          return;
        }
        blob.current = new Blob(chunks, {
          type: r.mimeType || mime || 'audio/webm',
        });
        await writes.current;
        if (!storageError.current)
          await store
            .updateRecording(account, recordingId.current, { state: 'ready' })
            .catch(() => {
              setDurable(false);
              setDurable(false);
              storageError.current =
                'Device storage failed. Download your audio before leaving.';
            });
        window.dispatchEvent(new Event('do-recordings'));
        if (mounted.current) void process();
        else {
          unlock.current?.();
          unlock.current = null;
        }
      };
      r.onerror = () => {
        setError(
          'The microphone was interrupted. We’ll try to save what was captured.',
        );
        stop();
      };
      mic.getAudioTracks().forEach((t) => (t.onended = stop));
      r.start(1000);
      startMeter(mic);
      setSettled('');
      setTail('');
      void startPreview();
      setSeconds(0);
      setState('recording');
      const started = Date.now();
      timer.current = setInterval(
        () => setSeconds(Math.floor((Date.now() - started) / 1000)),
        500,
      );
      timeout.current = setTimeout(stop, 300000);
    } catch (e) {
      release();
      unlock.current?.();
      unlock.current = null;
      setState('idle');
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in your browser’s website settings, then tap record again.'
          : errorMessage(e),
      );
    }
  }
  function saveAudio() {
    if (!blob.current) return;
    const url = URL.createObjectURL(blob.current);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      'do-recording.' + (blob.current.type.includes('mp4') ? 'm4a' : 'webm');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const live = state === 'recording';
  const working = state === 'starting' || state === 'processing';

  // Recording takes over the surface. The meter is the point: it is the only
  // thing on screen that proves the microphone is hearing you.
  if (live || working) {
    return (
      <>
        <div className={compact ? 'stage stage-compact' : 'stage'}>
          <div className="stage-status">
            {live ? (
              <>
                <span className="stage-dot" />
                Listening
              </>
            ) : (
              'Saving'
            )}
          </div>
          <p className="stage-timer">{clock}</p>
          <div className="stage-meter" aria-hidden="true">
            {levels.map((value, i) => (
              <span
                key={i}
                style={{ height: `${Math.max(3, Math.round(value * 56))}px` }}
              />
            ))}
          </div>
          <p className="stage-transcript" aria-live="polite">
            {live && (settled || tail) ? (
              <>
                <b>{settled}</b>
                {tail}
              </>
            ) : live ? (
              'Keep going. Your words are saved on this device as you speak.'
            ) : state === 'starting' ? (
              'Opening your microphone…'
            ) : (
              'Turning your words into a thought…'
            )}
          </p>
          <div className="stage-actions">
            {live && (
              <button type="button" className="stage-stop" onClick={stop}>
                <Square fill="currentColor" size={17} />
                Stop and save
              </button>
            )}
            {state === 'processing' && (
              <div className="stage-progress" aria-hidden="true">
                <i />
              </div>
            )}
            {live && (
              <button type="button" className="stage-quiet" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
        {error && (
          <Alert variant="destructive" className="error-message" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  return (
    <>
      <div className={compact ? 'recorder compact' : 'recorder'}>
        <Button
          className="record-button"
          onClick={() => void start()}
          disabled={state !== 'idle'}
          aria-label="Start recording"
        >
          <Mic />
        </Button>
        <p className="record-caption" aria-live="polite">
          {state === 'retry' ? 'Your recording is still here' : 'Tap to start talking'}
        </p>
        <p className="subtle text-sm">
          {state === 'retry'
            ? 'Saved recordings can be recovered after reopening. Download audio if device storage failed.'
            : 'Up to 5 minutes. Saved to Clipboard after transcription.'}
        </p>
        {error && (
          <Alert variant="destructive" className="error-message" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {state === 'retry' && (
          <div className="actions justify-center">
            {durable && (
              <Button
                variant="outline"
                className="control"
                onClick={() => {
                  blob.current = null;
                  transcript.current = null;
                  setState('idle');
                  setError('');
                  window.dispatchEvent(new Event('do-recordings'));
                }}
              >
                Keep for later
              </Button>
            )}
            <Button className="control" onClick={() => void process()}>
              <RotateCcw /> Retry
            </Button>
            <Button variant="outline" className="control" onClick={saveAudio}>
              <Download /> Save audio
            </Button>
            <Button
              variant="ghost"
              className="control"
              onClick={() => setConfirmDiscard(true)}
            >
              Discard recording
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the saved audio from this device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white"
              onClick={() => {
                setConfirmDiscard(false);
                void withRecordingLock(recordingId.current, () =>
                  store.deleteRecording(account, recordingId.current),
                )
                  .then(() => {
                    window.dispatchEvent(new Event('do-recordings'));
                    blob.current = null;
                    transcript.current = null;
                    setState('idle');
                    setError('');
                  })
                  .catch((e) => setError(errorMessage(e)));
              }}
            >
              Discard recording
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
