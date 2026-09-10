import {
  getAccount,
  listRecordings,
  beginRecording,
  appendChunk,
  updateRecording,
  readAudio,
  deleteRecording,
} from './recording-store.js';
const button = document.querySelector('#record'),
  status = document.querySelector('#status'),
  error = document.querySelector('#error'),
  list = document.querySelector('#recordings');
let account,
  recorder,
  stream,
  releaseLock,
  timer,
  clock,
  busy = false;
function stop() {
  if (recorder?.state === 'recording') recorder.stop();
}
async function refresh() {
  list.replaceChildren();
  for (const r of await listRecordings(account)) {
    const div = document.createElement('div');
    div.className = 'item';
    const label = document.createElement('p');
    label.textContent =
      new Date(r.createdAt).toLocaleString() +
      ' · ' +
      (r.bytes / 1000000).toFixed(1) +
      ' MB';
    div.append(label);
    for (const action of ['Download audio', 'Discard']) {
      const b = document.createElement('button');
      b.textContent = action;
      b.onclick = async () => {
        if (busy) return;
        try {
          await navigator.locks.request(
            'do-recording-' + r.id,
            { ifAvailable: true },
            async (lock) => {
              if (!lock)
                throw new Error('This recording is active in another tab.');
              if (action === 'Discard') {
                if (confirm('Permanently discard this recording?'))
                  await deleteRecording(account, r.id);
              } else {
                const blob = await readAudio(account, r.id);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download =
                  'do-recording-' +
                  r.id +
                  (r.mime.includes('mp4') ? '.m4a' : '.webm');
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              }
            },
          );
          await refresh();
        } catch (e) {
          error.textContent = e.message;
        }
      };
      div.append(b);
    }
    list.append(div);
  }
}
try {
  account = await getAccount();
  if (!account)
    throw new Error(
      'Open the workspace online and sign in once before using offline capture.',
    );
  if (
    !navigator.locks ||
    !navigator.mediaDevices?.getUserMedia ||
    !globalThis.MediaRecorder
  )
    throw new Error('Update Safari or Chrome to record here.');
  button.disabled = false;
  status.textContent = 'Ready to capture offline.';
  await refresh();
} catch (e) {
  error.textContent = e.message;
}
button.onclick = async () => {
  if (recorder?.state === 'recording') {
    stop();
    return;
  }
  if (busy) return;
  busy = true;
  button.disabled = true;
  error.textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      audioBitsPerSecond: 64000,
    });
    const id = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      navigator.locks
        .request('do-recording-' + id, async () => {
          resolve();
          await new Promise((r) => (releaseLock = r));
        })
        .catch(reject);
    });
    await beginRecording(account, id, recorder.mimeType, { kind: 'note' });
    let writes = Promise.resolve(),
      index = 0,
      bytes = 0,
      failed = false;
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      bytes += e.data.size;
      const i = index++;
      writes = writes
        .then(() => appendChunk(account, id, i, e.data))
        .catch(() => {
          failed = true;
          error.textContent =
            'Storage is full or unavailable. Recover saved chunks below; the last audio may be missing.';
          stop();
        });
      if (bytes > 19000000) stop();
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(timer);
      clearInterval(clock);
      await writes;
      try {
        await updateRecording(account, id, { state: 'ready' });
        status.textContent = failed
          ? 'Recording interrupted by storage failure.'
          : 'Saved on this device. Reopen online to transcribe.';
      } catch {
        error.textContent =
          'Could not finalize recording. Download available audio below.';
      } finally {
        releaseLock?.();
        releaseLock = null;
        busy = false;
        button.textContent = 'Start recording';
        button.disabled = false;
        await refresh();
      }
    };
    recorder.onerror = stop;
    stream.getAudioTracks().forEach((t) => (t.onended = stop));
    recorder.start(1000);
    button.textContent = 'Stop recording';
    button.disabled = false;
    const started = Date.now();
    clock = setInterval(() => {
      status.textContent =
        Math.floor((Date.now() - started) / 1000) +
        ' seconds · Recording on this device';
    }, 500);
    timer = setTimeout(stop, 300000);
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    releaseLock?.();
    releaseLock = null;
    busy = false;
    button.disabled = false;
    error.textContent = e.message;
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
});
window.addEventListener('beforeunload', (e) => {
  if (busy) e.preventDefault();
});
