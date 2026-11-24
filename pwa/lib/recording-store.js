// Read-only access to audio left on this device by the retired recorder.
// Nothing writes new recordings. The database name and layout are unchanged
// so recordings made before the recorder was removed remain readable.
export const RECORDING_DB = 'do-recordings-v2';
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(RECORDING_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('recordings', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['id', 'index'] });
      db.createObjectStore('session');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transaction(stores, mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Local recording storage failed.'));
    };
    try {
      run(tx, (v) => {
        result = v;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
// The database is shared by every account that used this browser. Each record
// carries its account, and every operation checks it.
export const listRecordings = (account) =>
  transaction(['recordings'], 'readonly', (tx, done) => {
    tx.objectStore('recordings').getAll().onsuccess = (e) =>
      done(
        e.target.result
          .filter((r) => r.account === account)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
  });
export function readAudio(account, id) {
  return transaction(['recordings', 'chunks'], 'readonly', (tx, done) => {
    tx.objectStore('recordings').get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (!r || r.account !== account) {
        tx.abort();
        return;
      }
      tx
        .objectStore('chunks')
        .getAll(
          IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
        ).onsuccess = (e) =>
        done(
          new Blob(
            e.target.result.map((c) => c.blob),
            { type: r.mime },
          ),
        );
    };
  });
}
export function deleteRecording(account, id) {
  return transaction(['recordings', 'chunks'], 'readwrite', (tx) => {
    const store = tx.objectStore('recordings');
    store.get(id).onsuccess = (e) => {
      if (e.target.result?.account !== account) {
        tx.abort();
        return;
      }
      store.delete(id);
      tx.objectStore('chunks').delete(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
      );
    };
  });
}
