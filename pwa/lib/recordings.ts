import { api, post } from './client';
import type { Clip, ClipKind } from './domain';
import * as store from '../public/recording-store.js';
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
export async function recoverRecording(
  recording: SavedRecording,
): Promise<Clip> {
  const { account, id, target } = recording;
  let transcript = recording.transcript;
  if (!transcript) {
    const audio = (await store.readAudio(account, id)) as Blob;
    if (audio.size < 100)
      throw new Error(
        'This recording has no recoverable audio. You can discard it.',
      );
    const form = new FormData();
    form.append(
      'audio',
      audio,
      'recording.' +
        (audio.type.includes('mp4')
          ? 'm4a'
          : audio.type.includes('ogg')
            ? 'ogg'
            : 'webm'),
    );
    transcript = (
      await api<{ text: string }>('transcribe', { method: 'POST', body: form })
    ).text;
    await store.updateRecording(account, id, { transcript });
  }
  let clip: Clip;
  if (target.clipId) {
    const current = await api<Clip>('clips/' + target.clipId);
    clip = await api<Clip>('clips/' + current.id, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'append',
        revision: current.revision,
        content: transcript,
        segmentId: id,
      }),
    });
  } else {
    clip = await post<Clip>('clips', {
      id,
      content: transcript,
      kind: target.kind ?? 'note',
      context: target.context ?? '',
    });
  }
  // Recover the original safely; templates can be applied from the editor without duplicate AI versions on retries.
  await store.deleteRecording(account, id);
  return clip;
}
export async function withRecordingLock<T>(
  id: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw new Error(
      'Recovery needs a browser with Web Locks. Update Safari or Chrome, or download your audio.',
    );
  return navigator.locks.request(
    'do-recording-' + id,
    { ifAvailable: true },
    (lock) => {
      if (!lock)
        throw new Error(
          'This recording is active in another tab. Stop it there first.',
        );
      return task();
    },
  );
}
