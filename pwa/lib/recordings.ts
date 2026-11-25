import { post } from './client';
import type { Clip, ClipKind } from './domain';
import * as store from './recording-store.js';
export { store };
export type RecordingTarget = {
  clipId?: string;
  kind?: ClipKind;
  context?: string;
  templateId?: string;
};
export type SavedRecording = {
  id: string;
  account: string;
  mime: string;
  target: RecordingTarget;
  createdAt: number;
  bytes: number;
  state: string;
  transcript: string | null;
};
export function audioFileName(recording: Pick<SavedRecording, 'id' | 'mime'>) {
  const extension = recording.mime.includes('mp4')
    ? '.m4a'
    : recording.mime.includes('ogg')
      ? '.ogg'
      : '.webm';
  return 'recording-' + recording.id + extension;
}
/**
 * Saves a transcript that the retired recorder cached on this device as
 * ordinary Clipboard text. The local record is left in place. The recording id
 * is the clip id, so saving twice never creates a second copy.
 */
export async function saveTranscript(recording: SavedRecording): Promise<Clip> {
  if (!recording.transcript?.trim())
    throw new Error('This recording has no saved transcript.');
  return post<Clip>('clips', {
    id: recording.id,
    content: recording.transcript,
    kind: 'note',
  });
}
export async function withRecordingLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  // Older browsers without Web Locks cannot have another tab recording.
  if (!navigator.locks) return task();
  return navigator.locks.request(
    'do-recording-' + id,
    { ifAvailable: true },
    (lock) => {
      if (!lock)
        throw new Error(
          'This recording is in use in another tab. Close that tab first.',
        );
      return task();
    },
  );
}
